import * as dotenv from 'dotenv';
dotenv.config();

import { fetchWikiPage, parseWikiProblem, renderKatex } from "vo-core";

import { createServer } from "http";
import { Server, Socket } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173",
    },
});

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

let { data: publicRooms, error } = await supabase.from('rooms').select(`id, name, description, mode, players`, { count: 'exact' }).eq('public', 'true');
console.log(publicRooms);

const publicRoomsSubscription = supabase.from('rooms').on('*', async payload => {
    console.log(payload);
    let { data, error } = await supabase.from('rooms').select(`id, name, description, mode, players`, { count: 'exact' }).eq('public', 'true');
    publicRooms = data;
}).subscribe();

io.on("connection", (socket: Socket) => {
    console.log(socket.id);
});

httpServer.listen(4000);
