import dayjs from 'dayjs';

// Dates from the API are midnight UTC. Using only the date part shows the same day in every time zone.
export const formatDate = (iso: string | null | undefined) =>
    iso ? dayjs(iso.slice(0, 10)).format('DD MMM YYYY') : '';

export const formatDateTime = (iso: string) => dayjs(iso).format('DD MMM, HH:mm');

export const titleCase = (s: string) =>
    s
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');