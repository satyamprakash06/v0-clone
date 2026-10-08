export function getProjectThumbnailUrl(seed: string) {
  return `https://api.dicebear.com/10.x/glass/svg?backgroundColor=6b705c,a5a58d,b98b73,7c9082,8e9aaf,9c6b58&seed=${encodeURIComponent(seed)}`;
}
