import * as dotenv from 'dotenv';
dotenv.config();
import { createServer } from "http";
import { Server } from "socket.io";
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === "development" ? "*" : "https://voly.mathetal.org",
    },
});
import { auth, rtdb } from "./firebase.js";
io.on("connection", (socket) => {
    console.log(socket.id + " CONNECTS");
    socket.on("create-room", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { uid } = decoded;
        const { roomName: name, roomDescription: description, roomMode: mode, roomPublic } = data;
        if (uid == null) {
            socket.emit('create-room-error', { error: 'error: room creation: not logged in', message: 'You must log in to create or join rooms!' });
        }
        try {
            const rtdbUser = (await rtdb.ref('authUsers/' + uid).once('value')).val();
            if (rtdbUser != null) {
                socket.emit('create-room-error', { error: 'error: room creation: already in a room', message: 'You are already in a room!' });
                return;
            }
            console.log(socket.id + " UID:" + uid + " requests CREATE");
            const roomPush = rtdb.ref('rooms').push();
            const roomId = roomPush.key;
            await Promise.all([
                roomPush.set({
                    name,
                    description,
                    mode,
                    roomPublic,
                    teamsEnabled: false,
                    maxUsers: 8,
                    host: {
                        socketId: socket.id,
                        userId: uid
                    },
                    users: {
                        [socket.id]: {
                            userId: uid
                        }
                    }
                }),
                rtdb.ref('roomUsers/' + roomId).set({
                    responses: {
                        [uid]: {
                            socketId: socket.id,
                            status: 0,
                            response: null
                        }
                    }
                }),
                rtdb.ref('publicRooms/' + roomId).set(true),
                rtdb.ref('authUsers/' + uid).set({
                    room: roomId,
                    socketId: socket.id
                })
            ]);
            socket.join(roomId);
            socket.emit('create-room-success', {
                roomId
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
            try {
                const { roomPublic, users } = (await rtdb.ref('rooms/' + room).once('value')).val();
                const { [socket.id]: { userId } } = users;
                if (Object.keys(users).length <= 1) {
                    let deletePromise = [
                        rtdb.ref('rooms/' + room).remove(),
                        rtdb.ref('roomUsers/' + room).remove(),
                        rtdb.ref('authUsers/' + userId).remove()
                    ];
                    if (roomPublic) {
                        deletePromise.push(rtdb.ref('publicRooms/' + room).remove());
                    }
                    await Promise.all(deletePromise);
                    return;
                }
                await Promise.all([
                    rtdb.ref('rooms/' + room + '/users/' + socket.id).remove(),
                    rtdb.ref('roomUsers/' + room + '/responses/' + userId).remove(),
                    rtdb.ref('authUsers/' + userId).remove()
                ]);
            }
            catch (error) {
                console.error(error);
            }
        }
    });
    socket.on("join-room", async ({ idToken, data }) => {
        const decoded = await auth.verifyIdToken(idToken);
        const { uid } = decoded;
        const { code } = data;
        try {
            const rtdbUser = (await rtdb.ref('authUsers/' + uid).once('value')).val();
            if (rtdbUser != null) {
                socket.emit('join-room-error', { error: 'error: joining room: already in a room', message: 'You are already in a room!' });
                return;
            }
            const requestRoom = (await rtdb.ref('rooms/' + code).once('value'));
            if (!requestRoom.exists()) {
                socket.emit('join-room-error', { error: 'error: joining room: room does not exist', message: 'The room does not exist!' });
                return;
            }
            if (requestRoom.val().maxUsers <= Object.keys(requestRoom.val().users).length) {
                socket.emit('join-room-error', { error: 'error: joining room: room is full', message: 'The room is already full!' });
                return;
            }
            console.log(socket.id + " UID:" + rtdbUser + " requests JOIN " + code);
            await Promise.all([
                rtdb.ref('rooms/' + code + '/users').update({
                    [socket.id]: {
                        userId: uid
                    }
                }),
                rtdb.ref('roomUsers/' + code + '/responses').update({
                    [uid]: {
                        socketId: socket.id,
                        status: 0,
                        response: null
                    }
                }),
                rtdb.ref('authUsers/' + uid).set({
                    room: code,
                    socketId: socket.id
                })
            ]);
            socket.join(code);
            socket.emit('join-room-success', {
                roomId: code
            });
        }
        catch (error) {
            console.error(error);
        }
    });
});
httpServer.listen(4000);