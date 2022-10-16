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

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

let { data: publicRooms, error, status } = await supabase.from('rooms').select(`id, name, description, mode, players`, { count: 'exact' }).eq('public', 'true');
console.log(publicRooms);

supabase.channel('public:rooms').on('postgres_changes', {event: '*', schema: '*', table:'rooms'}, async payload => {
    let { data, error } = await supabase.from('rooms').select(`id, name, description, mode, players`, { count: 'exact' }).eq('public', 'true');
    publicRooms = data;
    console.log(publicRooms);
}).subscribe();

io.on("connection", (socket: Socket) => {
    console.log(socket.id);

    socket.on("create-room", async ({ user, data: { name, description, mode, isPublic }}) => {
        try {
            const { data, error } = await supabase.from('rooms').upsert([{
                name,
                description,
                mode,
                isPublic,
                players: JSON.stringify({
                    [socket.id]: {
                        user, 
                        answers: []
                    }
                }),
                created_at: new Date()
            }]).select();
    
            if (error) {
                throw error;
            }

            socket.emit('create-room-success', {data});
        }
        catch ({message}) {
            socket.emit("create-room-error", { data: "Error Creating Room: " + message });
            console.error("Error Creating Room:", message);
        }
    });
});

httpServer.listen(4000);
