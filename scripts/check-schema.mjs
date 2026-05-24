import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from("admin_users")
    .select("password_hash")
    .limit(1);

  if (error) {
    console.log("Error or column missing:", error.message);
  } else {
    console.log("Column password_hash exists.");
  }
}

check();
