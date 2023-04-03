
const GITHUB = {
    CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
}
if (GITHUB.CLIENT_ID === undefined || GITHUB.CLIENT_SECRET === undefined) {
    throw new Error("GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is undefined");
}

const env = {
    GITHUB: GITHUB as { CLIENT_ID: string, CLIENT_SECRET: string },
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
};


export default env;