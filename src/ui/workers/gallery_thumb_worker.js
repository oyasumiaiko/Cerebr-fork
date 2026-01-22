self.onmessage = async (event) => {
  const data = event.data || {};
  const id = data.id;
  if (!id) return;
  const url = typeof data.url === 'string' ? data.url : '';
  const size = Number(data.size || 0);
  const quality = typeof data.quality === 'number' ? data.quality : 0.82;
  if (!url || !size || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    self.postMessage({ id, ok: false, error: 'unsupported' });
    return;
  }
  try {
    const response = await fetch(url);
    if (!response || !response.ok) {
      self.postMessage({ id, ok: false, error: 'fetch', status: response ? response.status : 0 });
      return;
    }
    const sourceBlob = await response.blob();
    const bitmap = await createImageBitmap(sourceBlob);
    if (!bitmap || !bitmap.width || !bitmap.height) {
      if (bitmap && bitmap.close) bitmap.close();
      self.postMessage({ id, ok: false, error: 'decode' });
      return;
    }
    const maxSide = Math.max(bitmap.width, bitmap.height);
    const scale = maxSide > 0 ? (size / maxSide) : 1;
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (bitmap && bitmap.close) bitmap.close();
      self.postMessage({ id, ok: false, error: 'context' });
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    if (bitmap && bitmap.close) bitmap.close();
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (!outBlob) {
      self.postMessage({ id, ok: false, error: 'encode' });
      return;
    }
    const buffer = await outBlob.arrayBuffer();
    self.postMessage({ id, ok: true, buffer, mime: 'image/jpeg' }, [buffer]);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: 'exception',
      message: String(error && error.message ? error.message : error)
    });
  }
};
