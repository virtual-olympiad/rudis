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

const zJoinRoomData = z.object({
    code: z.string().uuid()
});

// TODO: Atomize everything
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
        return emitError(socket, 'supabaseError', 'Error creating room data.', createRoomDataError);
    }

    const { error: insertLinkError } = await supabase.from('arena_users_rooms').insert({
        user_id: user.id,
        room_code: roomData.code,
    });

    if (insertLinkError){
        return emitError(socket, 'supabaseError', 'Error adding User-Room link.', insertLinkError);
    }

    socket.emit('create-room:success');
    
    return true;
};

async function joinRoom(socket: Socket, user: User, data: z.infer<typeof zJoinRoomData>) {
    const { data: userRoomData } = await supabase.from('arena_users_rooms').select('room_code').eq('user_id', user.id).limit(1).single();

    if (userRoomData?.room_code){
        return emitError(socket, 'coreError', 'Cannot join room, user is already in a room.');
    }

    try {
        zJoinRoomData.parse(data);
    } catch (e){
        return emitError(socket, 'inputError', 'Invalid input data type for room joining.');
    }

    const { code } = data;

    const { data: userJoinRoomData } = await supabase.from('arena_rooms').select(`
        players,
        max_players
    `).eq('code', code).limit(1).single();

    if (!userJoinRoomData?.players?.length || !userJoinRoomData?.max_players){
        return emitError(socket, 'coreError', 'Invalid room code.');
    }

    if (userJoinRoomData.players.length >= userJoinRoomData.max_players){
        return emitError(socket, 'coreError', 'Cannot join room, room is full.');
    }

    const { error: joinRoomError } = await supabase.rpc('add_player', {
        room_code: code,
        player: user.id
    });
    
    if (joinRoomError){
        return emitError(socket, 'supabaseError', 'Error joining room.', joinRoomError);
    }

    const { error: insertLinkError } = await supabase.from('arena_users_rooms').insert({
        user_id: user.id,
        room_code: code,
    });

    if (insertLinkError){
        return emitError(socket, 'supabaseError', 'Error adding User-Room link.', insertLinkError);
    }

    socket.emit('join-room:success');
    
    return true;
};

const zEditRoomData = z.object({
    title: z.string().min(1).max(20),
    description: z.string().max(200),
    max_players: z.coerce.number().int().min(1).max(16),
    private: z.boolean(),
});

async function editSettingsRoom(socket: Socket, user: User, data: z.infer<typeof zEditRoomData>) {
    const { data: roomData, error } = await supabase.from('arena_users_rooms').select(`
        arena_rooms (
            code,
            players,
            host
        )
        `).eq('user_id', user.id).limit(1).single();
    
    let room;

    if (Array.isArray(roomData?.arena_rooms)) {
        room = roomData.arena_rooms[0];
    } else {
        room = roomData?.arena_rooms;
    }

    if (error || !room?.code || room?.host !== user.id){
        return emitError(socket, 'coreError', 'Cannot edit settings, user is not a room host.');
    }

    let parsedData;

    try {
        parsedData = zEditRoomData.parse(data);
    } catch (e){
        return emitError(socket, 'inputError', 'Invalid input data type for settings.');
    }

    if (parsedData.max_players < room.players.length){
        return emitError(socket, 'coreError', 'Cannot set max players lower than current player count.');
    }

    const { error: updateSettingsError } = await supabase.from('arena_rooms').update({
        ...parsedData
    }).eq('code', room.code);

    if (updateSettingsError){
        return emitError(socket, 'supabaseError', 'Error editing room settings.', updateSettingsError);
    }

    socket.emit('edit-settings:success');
    
    return true;
};

const zEditGameData = z.object({
    mode: zModeEnum,
    duration: z.coerce.number().int().min(1).max(300)
});

async function editSettingsGame(socket: Socket, user: User, data: z.infer<typeof zEditGameData>) {
    const { data: roomData, error } = await supabase.from('arena_users_rooms').select(`
        arena_rooms (
            code,
            host
        )
        `).eq('user_id', user.id).limit(1).single();
    
    let room;

    if (Array.isArray(roomData?.arena_rooms)) {
        room = roomData.arena_rooms[0];
    } else {
        room = roomData?.arena_rooms;
    }

    if (error || !room?.code || room?.host !== user.id){
        return emitError(socket, 'coreError', 'Cannot edit settings, user is not a room host.');
    }

    let parsedData;

    try {
        parsedData = zEditGameData.parse(data);
    } catch (e){
        return emitError(socket, 'inputError', 'Invalid input data type for settings.');
    }

    const { error: updateSettingsError } = await supabase.from('arena_rooms').update({
        mode: parsedData.mode,
        settings_game: parsedData
    }).eq('code', room.code);

    if (updateSettingsError){
        return emitError(socket, 'supabaseError', 'Error editing game settings.', updateSettingsError);
    }

    socket.emit('edit-settings:success');

    return true;
}

const zSourceData = z.object({
    problemCount: z.coerce.number().int().min(0).max(100),
    correctValue: z.coerce.number(),
    incorrectValue: z.coerce.number(),
    blankValue: z.coerce.number(),
    selected: z.boolean()
});

const zEditProblemsetData = z.object({
    amc8: zSourceData,
    amc10: zSourceData,
    amc12: zSourceData,
    aime: zSourceData,
    mo: zSourceData
});

async function editSettingsProblemset(socket: Socket, user: User, data: z.infer<typeof zEditProblemsetData>) {
    const { data: roomData, error } = await supabase.from('arena_users_rooms').select(`
        arena_rooms (
            code,
            host
        )
        `).eq('user_id', user.id).limit(1).single();
    
    let room;

    if (Array.isArray(roomData?.arena_rooms)) {
        room = roomData.arena_rooms[0];
    } else {
        room = roomData?.arena_rooms;
    }

    if (error || !room?.code || room?.host !== user.id){
        return emitError(socket, 'coreError', 'Cannot edit settings, user is not a room host.');
    }

    let parsedData;

    try {
        parsedData = zEditProblemsetData.parse(data);
    } catch (e){
        return emitError(socket, 'inputError', 'Invalid input data type for settings.');
    }

    const { error: updateSettingsError } = await supabase.from('arena_rooms').update({
        settings_problemset: parsedData
    }).eq('code', room.code);

    if (updateSettingsError){
        return emitError(socket, 'supabaseError', 'Error editing problemset settings.', updateSettingsError);
    }

    socket.emit('edit-settings:success');
    
    return true;
}

export { createRoom, joinRoom, editSettingsRoom, editSettingsGame, editSettingsProblemset };