// draco3dgltf ships no types. The tests only hand its modules to gltf-transform
// as the Draco codec, so opaque is enough.
declare module 'draco3dgltf' {
  const draco3d: {
    createDecoderModule(): Promise<unknown>;
    createEncoderModule(): Promise<unknown>;
  };
  export default draco3d;
}
