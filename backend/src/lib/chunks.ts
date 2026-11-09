export function* chunks<T>(arr: T[], size = 1000) {
    for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}