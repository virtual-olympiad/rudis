import { User } from "@supabase/supabase-js";
import { type Socket } from "socket.io";
import { supabase } from "../lib/supabase.js";
import { z } from 'zod';
import { emitError, getProfile } from "../lib/utils.js";

const zModeEnum = z.enum(['standard'/**, 'guts', 'relay', 'blitz', 'showdown'*/]);

const zCreateRoomData = z.object({
    title: z.string().min(1).max(20),
    description: z.string().max(200),
    mode: zModeEnum,
    isPrivate: z.boolean(),
});

async function createRoom(socket: Socket, user: User, data: z.infer<typeof zCreateRoomData>) {
    const { data: userRoomData } = await supabase.from('arena_users_rooms').select('room_code').eq('user_id', user.id).limit(1).single();

    if (userRoomData?.room_code){
        return emitError(socket, 'coreError', 'Cannot create room, user is already in a room.');
    }

    try {
        zCreateRoomData.parse(data);
    } catch (e){
        return emitError(socket, 'inputError', 'Invalid input data type for room creation.');
    }

    const { title, description, mode, isPrivate } = data;

    // TODO: Atomize with remote call to database transaction function
    const { data: roomData, error: createRoomError } = await supabase.from('arena_rooms').insert({
        title,
        description,
        mode,
        host: user.id,
        private: isPrivate,
        players: [user.id]
    }).select('code').single();
    
    if (createRoomError || !roomData.code){
        console.error(createRoomError);
        return emitError(socket, 'supabaseError', 'Error creating room.');
    }
    
    const { error: createRoomDataError } = await supabase.from('arena_rooms_data').insert({
        code: roomData.code
    });

    if (createRoomDataError){
        return emitError(socket, 'supabaseError', 'Error creating room data.');
    }

    const { error: insertLinkError } = await supabase.from('arena_users_rooms').insert({
        user_id: user.id,
        room_code: roomData.code,
    });

    if (insertLinkError){
        return emitError(socket, 'supabaseError', 'Error adding User-Room link.');
    }

    socket.emit('create-room:success', {
        code: roomData.code
    });
    
    return true;
};

export { createRoom };