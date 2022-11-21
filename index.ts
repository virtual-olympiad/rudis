import * as dotenv from 'dotenv';
dotenv.config();

import { fetchWikiPage, parseWikiProblem, renderKatex } from "vo-core";

import { createServer } from "http";
import { Server, Socket } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "development" ? "*" : "https://voly.mathetal.org",
    },
});

import { app, auth, rtdb, db } from "./firebase.js";

io.on("connection", (socket: Socket) => {
    console.log(socket.id);

    socket.on("create-room", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { roomName: name, roomDescription: description, roomMode: mode, roomPublic } = data;
        console.log(decoded);
        console.log(data);

        try {
            await rtdb.ref('rooms/test').set({
                name,
                description,
                mode, 
                roomPublic,
                teamsEnabled: false,
                maxUsers: 8,
                users: [{
                    socketId: socket.id,
                    userId: decoded.uid
                }]
            });
        }
        catch (error) {
            console.error(error);
        }
    });
});

httpServer.listen(4000);
