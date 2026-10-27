// Online client: a WebSocket to the room, with reconnect by seat token.
// Calls back on server messages; sends steer and fingerprints.

const TOKEN_KEY = 'flood.token';

function loadToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(t) {
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* private mode: no resume */ }
}

export function connect({ name, onMessage, onStatus }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let ws, closed = false, retry = 0, lastSteer = null, sentAt = 0;

  const open = () => {
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      onStatus('open');
      ws.send(JSON.stringify({ t: 'hello', token: loadToken(), name }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') saveToken(msg.token);
      if (msg.t === 'resync') { ws.send(JSON.stringify({ t: 'hello', token: loadToken(), name })); return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus('lost');
      // Back off, then rejoin with the same token; the server replays the race.
      setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
    };
  };
  open();

  const send = (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
  return {
    // Send steer when it changes, and every second anyway so a lost message heals.
    // force: a press or release, sent even if it repeats the last value (a tap).
    // f: hurry (+1) or slow (-1) the drop.
    steer(s, now, force = false, f = 0) {
      const key = s * 3 + f;
      if (!force && key === lastSteer && now - sentAt < 1000) return;
      lastSteer = key;
      sentAt = now;
      send(f ? { t: 'in', s, f } : { t: 'in', s });
    },
    fingerprint(k, fp) { send({ t: 'fp', k, fp }); },
    close() { closed = true; ws.close(); },
  };
}
