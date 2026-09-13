/** Saves text as a file through the browser's download. Nothing leaves the device. */
export function downloadText(text: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later so the browser has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
