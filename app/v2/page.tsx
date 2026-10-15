import { redirect } from "next/navigation";

/** Keep the legacy player entry point behind the device-authorized customer catalog. */
export default function SoundSpaV2Page(): never {
  redirect("/player");
}
