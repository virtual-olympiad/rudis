import * as dotenv from "dotenv";
dotenv.config();

import { fetchWikiPage, parseWikiProblem, renderKatex } from "vo-core";

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

const exitSocketRoom = async (socketId, room)=> {
    try {
        const { roomPublic, users } = (
            await rtdb.ref("rooms/" + room).once("value")
        ).val();

        const {
            [socketId]: { userId },
        } = users;

        if (!userId){
            return;
        }

        if (Object.keys(users).length <= 1) {
            let deletePromise = [
                rtdb.ref("rooms/" + room).remove(),
                rtdb.ref("roomUsers/" + room).remove(),
                rtdb.ref("authUsers/" + userId).remove(),
                rtdb.ref("gameSettings/" + room).remove(),
            ];

            if (roomPublic) {
                deletePromise.push(
                    rtdb.ref("publicRooms/" + room).remove()
                );
            }

            await Promise.all(deletePromise);
            return;
        }

        await Promise.all([
            rtdb.ref("rooms/" + room + "/users/" + socketId).remove(),
            rtdb
                .ref("roomUsers/" + room + "/responses/" + userId)
                .update({ status: "disconnect" }),
            rtdb.ref("authUsers/" + userId).remove(),
        ]);
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

            console.log(socket.id + " UID:" + uid + " requests CREATE");

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
                rtdb.ref("roomUsers/" + roomId).set({
                    problems: [],
                    responses: {
                        [uid]: {
                            socketId: socket.id,
                            status: "lobby",
                            response: null,
                        },
                    },
                }),
                rtdb.ref("publicRooms/" + roomId).set(true),
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

            const requestRoom = await rtdb.ref("rooms/" + code).once("value");

            if (!requestRoom.exists()) {
                socket.emit("join-room-error", {
                    error: "error: joining room: room does not exist",
                    message: "The room does not exist!",
                });
                return;
            }

            if (
                requestRoom.val().maxUsers <=
                Object.keys(requestRoom.val().users).length
            ) {
                socket.emit("join-room-error", {
                    error: "error: joining room: room is full",
                    message: "The room is already full!",
                });
                return;
            }

            console.log(
                socket.id + " UID:" + rtdbUser + " requests JOIN " + code
            );

            await Promise.all([
                rtdb.ref("rooms/" + code + "/users").update({
                    [socket.id]: {
                        userId: uid,
                    },
                }),
                rtdb.ref("roomUsers/" + code + "/responses").update({
                    [uid]: {
                        socketId: socket.id,
                        status: 0,
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
        }
    });
    
    socket.on("exit-room", async () => {
        for (const room of socket.rooms) {
            if (room === socket.id) {
                continue;
            }

            await exitSocketRoom(socket.id, room);

            socket.emit("exit-room-success");
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

            if (gameSettings == null || roomSettings == null){
                return;
            }

            if (roomSettings.host.userId != uid){
                socket.emit("start-room-error", {
                    error: "error: invalid permissions",
                    message: "Only the owner can start the game!",
                });
                return;
            }
            
            console.log(socket.id + " UID:" + uid + " requests START");

            await rtdb.ref("rooms/" + roomId + "/gameStarted").set(true);
            io.to(roomId).emit("starting-game");
            const problems = await generateProblems(gameSettings);
            
            console.log(socket.id + " UID:" + uid + " Generated:", problems);

            await rtdb.ref("roomUsers/" + roomId + "/problems").set(
                problems.map(value => {
                    return { problem: value?.problem };
                })
            );

            io.to(roomId).emit("started-game");
            
            /**
            setTimeout(async () => {
                io.to(roomId).emit("end-game");
                await rtdb.ref("roomUsers/" + roomId + "/problems").set(
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
