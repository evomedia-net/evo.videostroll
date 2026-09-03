// ffmpeg-static ships no types. It exports the absolute path of a pinned
// ffmpeg binary for the current platform, or null on an unsupported one.
declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
