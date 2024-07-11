import { Socket } from 'socket.io';
import { supabase } from './supabase.js';
import { z } from 'zod';

async function authorize(jwt: string){
    const { data: { user }, error } = await supabase.auth.getUser(jwt);

    if (!user || error){
        return false;
    }

    return user;
}

async function getProfile(id: string){
    const { data: profile, error } = await supabase.from('profiles').select().eq('id', id).limit(1).single();

    if (!profile || error){
        return false;
    }

    return profile;
}

async function emitError(socket: Socket, error: string, message: string, rawError?: any){
    if (error == 'supabaseError'){
        console.error('supabaseError:', rawError ?? "-");
    }

    socket.emit("error", {
        error, message
    });

    return false;
}

export { authorize, getProfile, emitError };