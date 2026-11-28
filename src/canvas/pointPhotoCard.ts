// iPhone: after a point for the laptop, show the one photo it took (the crop),
// what it was recognised as, and where the photo went. Shown only on this
// phone; the image itself never goes to the laptop. Tap or wait to close.

export const POINT_PHOTO_MS = 9000;

export function pointPhotoCaption(o: { label: string | null; cloud: boolean; bytes: number }): string {
  const what = o.label ? `Recognised: ${o.label}` : 'Not recognised';
  const where = o.cloud ? `this crop went to Gemini · ${(o.bytes / 1024).toFixed(1)} KB` : 'the photo stayed on this iPhone';
  return `${what} · ${where}. Only the answer went to the laptop.`;
}

export function showPointPhoto(root: HTMLElement, shot: { mimeType: string; dataBase64: string }, caption: string, doc: Document = document): () => void {
  root.querySelector('.mc-point-photo')?.remove();
  const card = doc.createElement('div');
  card.className = 'mc-point-photo';
  card.setAttribute('role', 'status');
  const title = doc.createElement('div');
  title.className = 'mc-point-photo-title';
  title.textContent = 'The photo this iPhone took';
  const img = doc.createElement('img');
  img.alt = 'What you pointed at';
  img.src = `data:${shot.mimeType};base64,${shot.dataBase64}`;
  const cap = doc.createElement('p');
  cap.className = 'mc-point-photo-caption';
  cap.textContent = caption;
  card.append(title, img, cap);
  root.append(card);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = (): void => { if (timer) clearTimeout(timer); timer = null; card.remove(); };
  card.addEventListener('click', close);
  timer = setTimeout(close, POINT_PHOTO_MS);
  return close;
}
