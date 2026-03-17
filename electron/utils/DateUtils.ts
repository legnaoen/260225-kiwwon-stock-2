
export function getKstDate(): string {
    const now = new Date();
    // Returns YYYY-MM-DD in Asia/Seoul timezone
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(now);
}

export function getKstTimestamp(): string {
    const now = new Date();
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(now).replace(' ', 'T');
}
