/** Spatial batches keep distant triangles out of the local contact query.
 * Triangles are never clipped or replaced with the batch's bounding box. */
export function collisionChunks(shell: Float32Array, cell = 8) {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < shell.length; i += 9) {
    const x = Math.floor((shell[i] + shell[i + 3] + shell[i + 6]) / (3 * cell));
    const z = Math.floor((shell[i + 2] + shell[i + 5] + shell[i + 8]) / (3 * cell));
    const key = `${x},${z}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    for (let k = 0; k < 9; k++) bucket.push(shell[i + k]);
  }
  return Array.from(buckets.values(), (triangles) => {
    const vertices: number[] = [],
      indices: number[] = [];
    const ids = new Map<string, number>();
    for (let i = 0; i < triangles.length; i += 3) {
      // Exact deduplication: no welding changes a vertex's position.
      const key = `${triangles[i]},${triangles[i + 1]},${triangles[i + 2]}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = vertices.length / 3;
        ids.set(key, id);
        vertices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
      }
      indices.push(id);
    }
    return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) };
  });
}
