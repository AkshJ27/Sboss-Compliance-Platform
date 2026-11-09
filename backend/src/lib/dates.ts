export const utcDate = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));

export const daysInMonth = (y: number, m0: number) =>
    new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export const parseDateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

export const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

// Today's date in India (UTC+5:30) as YYYY-MM-DD
export const todayInIndia = () =>
    new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);