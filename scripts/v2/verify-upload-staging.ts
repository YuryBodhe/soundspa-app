import { verifyContentUploads } from "./verify-content-uploads";
const username=process.env.V2_ADMIN_USERNAME;const password=process.env.V2_ADMIN_PASSWORD;
if(!username||!password)throw new Error("Explicit V2 operator configuration required.");
const authorization=`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
verifyContentUploads("http://127.0.0.1:3000",authorization,"https://test.soundspa.bodhemusic.com")
  .catch((error)=>{console.error(error instanceof Error?error.message:"Verification failed");process.exitCode=1;});
