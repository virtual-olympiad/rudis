import * as dotenv from 'dotenv';
dotenv.config();
import { createServer } from "http";
import { Server } from "socket.io";
const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173",
    },
});
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
io.on("connection", (socket) => {
    console.log(socket.id);
});
httpServer.listen(4000);
