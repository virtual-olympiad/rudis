import { supabase } from './supabase.js';
import { z } from 'zod';

async function authorize(jwt: string){
    const { data: { user }, error } = await supabase.auth.getUser(jwt);


    if (!user || error){
        return false;
    }

    return user;
}

export { authorize };