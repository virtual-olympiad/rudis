import "dotenv/config";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SB_PROJECT_URL as string,
    process.env.SB_SERVICE_KEY as string,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

export { supabase };
