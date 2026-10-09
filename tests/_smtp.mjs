/* Подставной почтовый сервер для проверок.

   Принимает письма по тому же протоколу, что и настоящий ящик, и
   складывает их в список: проверка смотрит, что ушло, кому и каким
   текстом. Наружу ничего не отправляет. Шифрования не умеет — сервис
   для него запускается с MAIL_SMTP_INSECURE=1.

   Общий для tests/mail-smtp.mjs и tests/mail-letters.mjs.            */

import { createServer } from "node:net";

const b64 = s => Buffer.from(s, "base64").toString("utf8");

/* Разбор принятого письма: заголовки и текст — так, как их увидит человек. */
export function read(letter) {
  const [head, ...rest] = letter.data.split("\r\n\r\n");
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const header = name => (unfolded.match(new RegExp("^" + name + ":\\s*(.*)$", "im")) || [])[1] || "";
  const word = v => v.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_, kind, body) =>
    kind.toLowerCase() === "b" ? b64(body)
      : Buffer.from(body.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary").toString("utf8"));
  let body = rest.join("\r\n\r\n");
  const enc = header("Content-Transfer-Encoding").toLowerCase();
  if (enc === "base64") body = b64(body.replace(/\s+/g, ""));
  else if (enc === "quoted-printable")
    body = Buffer.from(body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary").toString("utf8");
  body = body.replace(/^\.\./gm, ".");   // точки в начале строки почтовый протокол удваивает
  return { header, subject: word(header("Subject")), from: word(header("From")), body, type: header("Content-Type") };
}

/* Поднимает сервер. inbox — принятые письма, attempts — попытки входа. */
export async function startSmtp({ port, box, pass }) {
  const inbox = [];
  const attempts = [];

  const server = createServer(sock => {
    const s = { auth: null, from: "", to: [], data: "", inData: false, step: "" };
    let buf = "";
    const say = line => sock.write(line + "\r\n");
    const login = (user, password) => {
      attempts.push({ user, password });
      if (user === box && password === pass) { s.auth = user; say("235 2.7.0 Authentication successful"); }
      else say("535 5.7.8 Authentication failed");
    };
    say("220 podstavnoy.test ESMTP");
    sock.on("data", chunk => {
      buf += chunk.toString("utf8");
      if (s.inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return;
        s.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        s.inData = false;
        inbox.push({ auth: s.auth, from: s.from, to: [...s.to], data: s.data });
        say("250 2.0.0 OK: queued");
      }
      let nl;
      while (!s.inData && (nl = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const up = line.toUpperCase();
        if (s.step === "user") { s.user = b64(line); s.step = "pass"; say("334 UGFzc3dvcmQ6"); continue; }
        if (s.step === "pass") { s.step = ""; login(s.user, b64(line)); continue; }
        if (up.startsWith("EHLO") || up.startsWith("HELO")) { sock.write("250-podstavnoy.test\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 52428800\r\n"); }
        else if (up.startsWith("AUTH PLAIN")) {
          const parts = b64(line.slice(11)).split("\0");
          login(parts[1], parts[2]);
        }
        else if (up.startsWith("AUTH LOGIN")) { s.step = "user"; say("334 VXNlcm5hbWU6"); }
        else if (up.startsWith("MAIL FROM:")) {
          if (!s.auth) { say("530 5.7.0 Authentication required"); continue; }
          s.from = line.slice(10).replace(/[<>]/g, "").split(" ")[0]; s.to = []; say("250 2.1.0 OK");
        }
        else if (up.startsWith("RCPT TO:")) { s.to.push(line.slice(8).replace(/[<>]/g, "").trim()); say("250 2.1.5 OK"); }
        else if (up === "DATA") { s.inData = true; say("354 End data with <CR><LF>.<CR><LF>"); }
        else if (up === "RSET") { say("250 OK"); }
        else if (up === "QUIT") { say("221 Bye"); sock.end(); }
        else say("250 OK");
      }
    });
    sock.on("error", () => {});
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));

  return { inbox, attempts, read, close: () => server.close() };
}
