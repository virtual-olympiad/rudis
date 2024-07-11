import 'dotenv/config';

// import { fetchWikiPage, parseWikiProblem, parseKatexString } from "aesthete";

import { createServer } from "http";
import { Server, Socket } from "socket.io";

const httpServer = createServer();

const allowedOrigins = ["https://volympiad.org", "https://arena.volympiad.org", "https://judge.volympiad.org", "https://db.volympiad.org"];
const io = new Server(httpServer, {
    cors: {
        origin:
            process.env.NODE_ENV === "development"
                ? "*"
                : allowedOrigins,
    },
});

const PORT = process.env.PORT || 4000;

import { authorize } from './lib/utils.js';
import { createRoom, joinRoom } from './core/core.js';

let endGameTimeout: { [key: string]: any } = {};
let authTransacting: { [key: string]: any } = {};

io.on("connection", (socket: Socket) => {
    console.log(socket.id + " CONNECTS");
    console.log("Concurrent connections:", io.engine.clientsCount);

    io.emit('player-count:update', {
        value: io.engine.clientsCount
    });

    socket.on("create-room", async ({ token, data }) => {
        const user = await authorize(token);
        if (!user){
            socket.emit("error", {
                error: 'authError',
                message: 'Invalid user authentication.'
            });
            return;
        }

        await createRoom(socket, user, data);
    });

    socket.on("join-room", async ({ token, data }) => {
        const user = await authorize(token);
        if (!user){
            socket.emit("error", {
                error: 'authError',
                message: 'Invalid user authentication.'
            });
            return;
        }

        await joinRoom(socket, user, data);
    });
});

httpServer.listen(PORT);

console.log("HTTP Server started: Listening on port", PORT);