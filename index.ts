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
        const { uid } = decoded;
        const { roomName: name, roomDescription: description, roomMode: mode, roomPublic } = data;

        try {
            const rtdbUser = (await rtdb.ref('authUsers/' + uid).once('value')).val();

            if (rtdbUser != null){
                socket.emit('create-room-error', { error: 'error: room creation: already in a room', message: 'You are already in a room!' });
                return;
            }

            console.log(rtdbUser);

            const roomPush = rtdb.ref('rooms').push();
            const roomKey = roomPush.key;

            await roomPush.set({
                name,
                description,
                mode, 
                roomPublic,
                teamsEnabled: false,
                maxUsers: 8,
                users: {
                    [socket.id]: {
                        userId: uid
                    }
                }
            });

            await rtdb.ref('roomUsers/' + roomKey).set({
                responses: {
                    [uid]: {
                        socketId: socket.id,
                        status: 0,
                        response: null
                    }
                }
            });

            await rtdb.ref('authUsers/' + uid).set({
                room: roomKey,
                socketId: socket.id
            })

            socket.join(roomKey);
        }
        catch (error) {
            console.error(error);
        }
    });

    socket.on("disconnecting", async (reason) => {
        for (const room of socket.rooms){
            if (room === socket.id){
                continue;
            }

            try {
                const users = (await rtdb.ref('rooms/' + room + '/users').once('value')).val();
                const { [socket.id]: { userId }} = users;

                if (Object.keys(users).length <= 1){
                    await Promise.all([
                        rtdb.ref('rooms/' + room).remove(),
                        rtdb.ref('roomUsers/' + room).remove(),
                        rtdb.ref('authUsers/' + userId).remove()
                    ]);
                    return;
                }

                await Promise.all([
                    rtdb.ref('rooms/' + room + '/users/' + socket.id).remove(),
                    rtdb.ref('roomUsers/' + room + '/responses/' + userId).remove(),
                    rtdb.ref('authUsers/' + userId).remove()
                ]);
            } catch (error) {
                console.error(error);
            }
        }
    });
});

httpServer.listen(4000);