"use client"

import { signIn, signOut, useSession } from "next-auth/react";

// login button
export default function Login() {
    // get session
    const { data: session, status } = useSession();
    
    return (
        <div>
            {session ? (
                <div>
                    <p>Logged in as {session.user?.email}</p>
                </div>
            ) : (
                <div>
                    <p>Not signed in</p>
                </div>
            )}

            { !session ? <button onClick={() => signIn()}>Sign in</button> : <button onClick={() => signOut()}>Sign out</button> }
            

        </div>
    );
}