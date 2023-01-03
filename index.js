import * as dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import { Server } from "socket.io";
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "development"
            ? "*"
            : "https://voly.mathetal.org",
    },
});
const PORT = process.env.PORT || 4000;
import { auth, rtdb } from "./firebase.js";
import { generateProblems } from "./core.js";
const exitSocketRoom = async (socketId, room) => {
    try {
        let deleteRoom = false;
        let uid;
        let success = true;
        let { committed, snapshot } = await rtdb
            .ref("rooms/" + room)
            .transaction((value) => {
            success = true;
            deleteRoom = false;
            if (value == null ||
                value.users == null ||
                value.users[socketId] == null) {
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
                rtdb.ref("gameData/" + room).remove(),
                rtdb.ref("authUsers/" + uid).remove(),
                rtdb.ref("gameSettings/" + room).remove(),
            ]);
        }
        else {
            await Promise.all([
                rtdb
                    .ref("gameData/" + room + "/responses/" + uid)
                    .update({ status: "disconnect" }),
                rtdb.ref("authUsers/" + uid).remove(),
            ]);
        }
    }
    catch (error) {
        console.error(error);
    }
};
const compileResults = async (roomId, endReason) => {
    try {
        const contestData = (await rtdb
            .ref("gameSettings/" + roomId + "/contestData")
            .once("value")).val();
        if (!contestData) {
            return;
        }
        let success = false;
        const { committed, snapshot } = await rtdb
            .ref("gameData/" + roomId)
            .transaction((value) => {
            if (!value || !value?.results?.answers || !value?.responses) {
                return value;
            }
            let standings = [];
            let { results: { answers: solutions }, responses, } = value;
            for (const userId in responses) {
                const { status, answers } = responses[userId];
                if (status == "disconnect") {
                    continue;
                }
                if (status !== "submitted") {
                    value.responses[userId].finishTime =
                        value.data.startTime + value.data.timeLimit;
                }
                value.responses[userId].status = "submitted";
                let userStanding = {
                    userId,
                    correct: 0,
                    blank: 0,
                    score: 0,
                    timeUsed: value.responses[userId].finishTime -
                        value.data.startTime,
                };
                solutions.forEach((solution, i) => {
                    const response = answers[i];
                    const { blankScore, correctScore } = contestData[solution.contest];
                    if (response !== 0 && !response) {
                        // unanswered
                        ++userStanding.blank;
                        userStanding.score += blankScore;
                        return;
                    }
                    if ((Array.isArray(solution.answer) &&
                        solution.answer.includes(response)) ||
                        solution.answer === response) {
                        ++userStanding.correct;
                        userStanding.score += correctScore;
                        return;
                    }
                });
                standings.push(userStanding);
            }
            // Descending score order
            standings.sort((a, b) => {
                if (a.score == b.score) {
                    return a.timeUsed - b.timeUsed;
                }
                return b.score - a.score;
            });
            value.results.standings = standings;
            value.results.endReason = endReason;
            success = true;
            return value;
        });
        if (success) {
            await rtdb.ref("rooms/" + roomId + "/gameState").set("lobby");
        }
    }
    catch (error) {
        console.error(error);
    }
};
const endGameTimeout = {};
io.on("connection", (socket) => {
    console.log(socket.id + " CONNECTS");
    socket.on("create-room", async ({ idToken, data }) => {
        let decoded;
        try {
            decoded = await auth.verifyIdToken(idToken);
        }
        catch (error) {
            socket.emit("create-room-error", {
                error: "error: room creation: not logged in",
                message: "You must log in to create or join rooms!",
            });
            return;
        }
        const { uid } = decoded;
        const { roomName: name, roomDescription: description, roomMode: mode, roomPublic, } = data;
        if (!uid) {
            socket.emit("create-room-error", {
                error: "error: room creation: not logged in",
                message: "You must log in to create or join rooms!",
            });
        }
        try {
            const rtdbUser = (await rtdb.ref("authUsers/" + uid).once("value")).val();
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
                    gameState: "lobby",
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
                rtdb.ref("gameData/" + roomId).set({
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
                    contestData: {
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
        }
        catch (error) {
            console.error(error);
        }
    });
    socket.on("join-room", async ({ idToken, data }) => {
        let decoded;
        try {
            decoded = await auth.verifyIdToken(idToken);
        }
        catch (error) {
            socket.emit("join-room-error", {
                error: "error: joining room: not logged in",
                message: "You must log in to create or join rooms!",
            });
            return;
        }
        const { uid } = decoded;
        const { code } = data;
        try {
            const rtdbUser = (await rtdb.ref("authUsers/" + uid).once("value")).val();
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
                if (value == null ||
                    value.users == null ||
                    value.maxUsers == null) {
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
                }
                else {
                    socket.emit("join-room-error", {
                        error: "error: joining room: room is full",
                        message: "The room is already full!",
                    });
                }
                return;
            }
            console.log(socket.id + " UID:" + uid + " JOINS " + code);
            await Promise.all([
                rtdb.ref("gameData/" + code + "/responses").update({
                    [uid]: {
                        socketId: socket.id,
                        status: "unsubmitted",
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
                gameState: snapshot.val().gameState,
            });
        }
        catch (error) {
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
        let decoded;
        try {
            decoded = await auth.verifyIdToken(idToken);
        }
        catch (error) {
            return;
        }
        const { uid } = decoded;
        const { roomId } = data;
        try {
            const gameSettings = (await rtdb.ref("gameSettings/" + roomId).once("value")).val();
            const roomSettings = (await rtdb.ref("rooms/" + roomId).once("value")).val();
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
            console.log(socket.id + " UID:" + uid + " STARTS " + roomId);
            await rtdb
                .ref("rooms/" + roomId + "/gameState")
                .set("starting-game");
            io.to(roomId).emit("starting-game");
            const problems = await generateProblems(gameSettings);
            console.log(socket.id + " UID:" + uid + " GENERATES:", problems.map(({ pageTitle }) => {
                return pageTitle;
            }), "in ROOMID:" + roomId);
            problems.sort((a, b) => {
                return a.difficulty - b.difficulty;
            });
            await rtdb
                .ref("gameData/" + roomId + "/responses")
                .transaction((value) => {
                if (!value) {
                    return value;
                }
                for (let user in value) {
                    value[user] = {
                        ...value[user],
                        answers: [],
                        status: value[user].status == "submitted"
                            ? "unsubmitted"
                            : value[user].status,
                    };
                }
                return value;
            });
            await rtdb.ref("gameData/" + roomId + "/results").set({
                answers: problems,
            });
            await rtdb.ref("gameData/" + roomId + "/data").set({
                startTime: Date.now(),
                timeLimit: roomSettings.timeLimit * 60 * 1000,
                problems: problems.map((value) => {
                    let { problem, pageTitle, problemTitle, link, difficulty, answerType, category, } = value;
                    return {
                        problem,
                        answerType,
                    };
                }),
            });
            await rtdb.ref("rooms/" + roomId + "/gameState").set("game");
            io.to(roomId).emit("started-game");
            endGameTimeout[roomId] = setTimeout(async () => {
                let roomExists = true;
                await rtdb.ref("rooms/" + roomId).transaction((value) => {
                    roomExists = true;
                    if (!value) {
                        roomExists = false;
                        return value;
                    }
                    value.gameState = "compiling-results";
                    return value;
                });
                if (roomExists) {
                    await compileResults(roomId, "end-time");
                    io.to(roomId).emit("results-compiled");
                }
            }, roomSettings.timeLimit * 60000);
        }
        catch (error) {
            console.error(error);
        }
    });
    socket.on("submit-answer", async ({ idToken, data }) => {
        let decoded;
        try {
            decoded = await auth.verifyIdToken(idToken);
        }
        catch (error) {
            return;
        }
        const { uid } = decoded;
        const { roomId } = data;
        try {
            const snap = await rtdb
                .ref("rooms/" + roomId + "/gameState")
                .once("value");
            if (!snap.exists() || snap.val() != "game") {
                return;
            }
            let hasSubmitted = false;
            let { committed, snapshot } = await rtdb
                .ref("gameData/" + roomId + "/responses/" + uid)
                .transaction((value) => {
                if (!value || value?.status != "unsubmitted") {
                    return value;
                }
                value.status = "submitted";
                value.finishTime = Date.now();
                hasSubmitted = true;
                return value;
            });
            if (hasSubmitted) {
                // check if everyone has submitted, if so, compile results
                const snap = await rtdb
                    .ref("gameData/" + roomId + "/responses")
                    .once("value");
                if (!snap.exists()) {
                    return;
                }
                const responses = snap.val();
                for (const user in responses) {
                    let { status } = responses[user];
                    if (status == "unsubmitted") {
                        return;
                    }
                }
                clearTimeout(endGameTimeout[roomId]);
                await rtdb.ref("rooms/" + roomId).transaction((value) => {
                    if (!value) {
                        return value;
                    }
                    value.gameState = "compiling-results";
                    return value;
                });
                console.log(roomId + " ENDS GAME");
                await compileResults(roomId, "end-responses");
                io.to(roomId).emit("results-compiled");
            }
        }
        catch (error) {
            console.error(error);
        }
    });
});
httpServer.listen(PORT);
