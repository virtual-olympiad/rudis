import * as dotenv from "dotenv";
dotenv.config();

import { fetchWikiPage, parseWikiProblem, parseKatex } from "vo-core";

import { createServer } from "http";
import { Server, Socket } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin:
            process.env.NODE_ENV === "development"
                ? "*"
                : "https://voly.mathetal.org",
    },
});

const PORT = process.env.PORT || 4000;

import { app, auth, rtdb, db } from "./firebase.js";
import { generateProblems } from "./core.js";
import { ServerValue } from "firebase-admin/database";

const exitSocketRoom = async (socketId, room) => {
    try {
        let deleteRoom = false;
        let uid;
        let success = true;

        let { committed, snapshot } = await rtdb
            .ref("rooms/" + room)
            .transaction(value => {
                success = true;
                deleteRoom = false;

                if (
                    value == null ||
                    value.users == null ||
                    value.users[socketId] == null
                ) {
                    success = false;
                    return value;
                }

                uid = value.users[socketId].userId;

                // no users, delete room
                if (Object.keys(value.users).length <= 1) {
                    deleteRoom = true;
                    return null;
                }

                // transfer host
                if (value.host.socketId == socketId) {
                    for (const socket in value.users) {
                        if (socket == socketId) {
                            continue;
                        }

                        value.host = {
                            socketId: socket,
                            userId: value.users[socket].userId,
                        };
                        break;
                    }
                }

                // delete user
                value.users[socketId] = null;

                return value;
            });

        if (!success) {
            return;
        }

        if (deleteRoom) {
            await Promise.all([
                rtdb.ref("gameInfo/" + room).remove(),
                rtdb.ref("authUsers/" + uid).remove(),
                rtdb.ref("gameSettings/" + room).remove(),
            ]);
        } else {
            await Promise.all([
                rtdb
                    .ref("gameInfo/" + room + "/responses/" + uid)
                    .update({ status: "disconnect" }),
                rtdb.ref("authUsers/" + uid).remove(),
            ]);
        }
    } catch (error) {
        console.error(error);
    }
};

io.on("connection", (socket: Socket) => {
    console.log(socket.id + " CONNECTS");

    socket.on("create-room", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { uid } = decoded;
        const {
            roomName: name,
            roomDescription: description,
            roomMode: mode,
            roomPublic,
        } = data;

        if (uid == null) {
            socket.emit("create-room-error", {
                error: "error: room creation: not logged in",
                message: "You must log in to create or join rooms!",
            });
        }

        try {
            const rtdbUser = (
                await rtdb.ref("authUsers/" + uid).once("value")
            ).val();

            if (rtdbUser != null) {
                socket.emit("create-room-error", {
                    error: "error: room creation: already in a room",
                    message: "You are already in a room!",
                });
                return;
            }

            const roomPush = rtdb.ref("rooms").push();
            const roomId = roomPush.key;

            await Promise.all([
                roomPush.set({
                    name,
                    description,
                    mode,
                    roomPublic,
                    teamsEnabled: false,
                    maxUsers: 8,
                    timeLimit: 60,
                    gameStarted: false,
                    host: {
                        socketId: socket.id,
                        userId: uid,
                    },
                    users: {
                        [socket.id]: {
                            userId: uid,
                        },
                    },
                }),
                rtdb.ref("gameInfo/" + roomId).set({
                    problems: [],
                    responses: {
                        [uid]: {
                            socketId: socket.id,
                            status: "unsubmitted",
                            answers: [],
                        },
                    },
                }),
                rtdb.ref("authUsers/" + uid).set({
                    room: roomId,
                    socketId: socket.id,
                }),
                rtdb.ref("gameSettings/" + roomId).set({
                    contestSelection: {
                        amc8: true,
                        amc10: true,
                        amc12: true,
                        aime: true,
                    },
                    contestDetails: {
                        amc8: {
                            problemCount: 1,
                            correctScore: 6,
                            blankScore: 1.5,
                        },
                        amc10: {
                            problemCount: 1,
                            correctScore: 6,
                            blankScore: 1.5,
                        },
                        amc12: {
                            problemCount: 1,
                            correctScore: 6,
                            blankScore: 1.5,
                        },
                        aime: {
                            problemCount: 1,
                            correctScore: 10,
                            blankScore: 0,
                        },
                    },
                }),
            ]);

            socket.join(roomId);

            console.log(socket.id + " UID:" + uid + " CREATES " + roomId);

            socket.emit("create-room-success", {
                roomId,
            });
        } catch (error) {
            console.error(error);
        }
    });

    socket.on("join-room", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { uid } = decoded;
        const { code } = data;

        try {
            const rtdbUser = (
                await rtdb.ref("authUsers/" + uid).once("value")
            ).val();

            if (rtdbUser != null) {
                socket.emit("join-room-error", {
                    error: "error: joining room: already in a room",
                    message: "You are already in a room!",
                });
                return;
            }

            let success = true;

            let { committed, snapshot } = await rtdb
                .ref("rooms/" + code)
                .transaction((value) => {
                    success = true;

                    if (
                        value == null ||
                        value.users == null ||
                        value.maxUsers == null
                    ) {
                        success = false;
                        return value;
                    }

                    if (value.maxUsers <= Object.keys(value.users).length) {
                        success = false;
                        return value;
                    }

                    value.users[socket.id] = {
                        userId: uid,
                    };

                    return value;
                });

            if (!success) {
                if (!snapshot.exists()) {
                    socket.emit("join-room-error", {
                        error: "error: joining room: room does not exist",
                        message: "The room does not exist!",
                    });
                } else {
                    socket.emit("join-room-error", {
                        error: "error: joining room: room is full",
                        message: "The room is already full!",
                    });
                }
                return;
            }

            console.log(socket.id + " UID:" + uid + " JOINS " + code);

            await Promise.all([
                rtdb.ref("gameInfo/" + code + "/responses").update({
                    [uid]: {
                        socketId: socket.id,
                        status: "unsubmitted",
                        response: null,
                    },
                }),
                rtdb.ref("authUsers/" + uid).set({
                    room: code,
                    socketId: socket.id,
                }),
            ]);

            socket.join(code);
            socket.emit("join-room-success", {
                roomId: code,
                gameStarted: snapshot.val().gameStarted,
            });
        } catch (error) {
            console.error(error);
        }
    });

    socket.on("disconnecting", async (reason) => {
        for (const room of socket.rooms) {
            if (room === socket.id) {
                continue;
            }

            await exitSocketRoom(socket.id, room);
            console.log(socket.id + " DISCONNECTS from " + room);
        }
    });

    socket.on("exit-room", async () => {
        for (const room of socket.rooms) {
            if (room === socket.id) {
                continue;
            }

            await exitSocketRoom(socket.id, room);

            socket.emit("exit-room-success", { roomId: room });
            console.log(socket.id + " EXITS " + room);
        }
    });

    socket.on("start-game", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { uid } = decoded;
        const { roomId } = data;

        try {
            const gameSettings = (
                await rtdb.ref("gameSettings/" + roomId).once("value")
            ).val();

            const roomSettings = (
                await rtdb.ref("rooms/" + roomId).once("value")
            ).val();

            if (gameSettings == null || roomSettings == null) {
                return;
            }

            if (roomSettings.host.userId != uid) {
                socket.emit("start-game-error", {
                    error: "error: invalid permissions",
                    message: "Only the owner can start the game!",
                });
                return;
            }

            console.log(socket.id + " UID:" + uid + " requests START");

            await rtdb.ref("rooms/" + roomId + "/gameStarted").set(true);
            io.to(roomId).emit("starting-game");
            const problems = await generateProblems(gameSettings);

            console.log(
                socket.id + " UID:" + uid + " GENERATES:",
                problems.map(({ pagetitle }) => {
                    return pagetitle;
                }),
                "in ROOMID:" + roomId
            );

            problems.sort((a, b) => {
                return a.difficulty - b.difficulty;
            });

            await rtdb.ref("gameInfo/" + roomId + "/gameDetails").update({
                startTime: ServerValue.TIMESTAMP,
                timeLimit: roomSettings.timeLimit * 60 * 1000,
                problems: problems.map((value) => {
                    let { problem, pageTitle, problemTitle, link, difficulty, answerType, category } = value;

                    return {
                        problem,
                        answerType,
                    };
                }),
            });

            io.to(roomId).emit("started-game");

            /**
            setTimeout(async () => {
                io.to(roomId).emit("end-game");
                await rtdb.ref("gameInfo/" + roomId + "/problems").set(
                    problems
                );
            }, roomSettings.timeLimit * 60 * 1000);
            */
        } catch (error) {
            console.error(error);
        }
    });
});

httpServer.listen(PORT);
