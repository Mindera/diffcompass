interface BridgeOptions {
  command?: "context" | "next" | "watch" | "respond" | "ack" | "renew" | "progress" | "refresh";
  url?: string;
  tokenFile?: string;
  after: number;
  waitMs: number;
  eventId?: string;
  leaseId?: string;
  file?: string;
  verificationFile?: string;
}

function parseBridgeOptions(args: string[]): BridgeOptions {
  const command = args.shift();
  if (command && !["context", "next", "watch", "respond", "ack", "renew", "progress", "refresh"].includes(command)) {
    throw new Error(`Unknown bridge command: ${command}`);
  }
  const options: BridgeOptions = { command: command as BridgeOptions["command"], after: 0, waitMs: 50_000 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--url" && value) options.url = value;
    else if (arg === "--token-file" && value) options.tokenFile = value;
    else if (arg === "--after" && value) options.after = Number(value);
    else if (arg === "--wait-ms" && value) options.waitMs = Number(value);
    else if (arg === "--event" && value) options.eventId = value;
    else if (arg === "--lease" && value) options.leaseId = value;
    else if (arg === "--file" && value) options.file = value;
    else if (arg === "--verification-file" && value) options.verificationFile = value;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
    index += 1;
  }
  return options;
}

async function bridgeRequest(options: BridgeOptions, path: string, init?: RequestInit): Promise<unknown> {
  if (!options.url || !options.tokenFile) throw new Error("Both --url and --token-file are required.");
  const token = (await Bun.file(options.tokenFile).text()).trim();
  if (!token) throw new Error("The attached-agent token file is empty.");
  const response = await fetch(new URL(path, options.url), {
    ...init,
    headers: { "content-type": "application/json", "x-diffcompass-token": token, ...init?.headers },
  });
  const value = await response.json();
  if (!response.ok) throw new Error((value as { error?: string }).error ?? `Bridge request failed with ${response.status}.`);
  return value;
}

function bridgeEvents(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The bridge returned an invalid event response.");
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) throw new Error("The bridge returned an invalid event response.");
  return events;
}

export async function runBridgeCommand(args: string[]): Promise<number> {
  const options = parseBridgeOptions([...args]);
  if (!options.command) {
    console.log("Usage: diffcompass bridge context|next|watch|respond|ack|renew|progress|refresh --url URL --token-file PATH [options]");
    return 0;
  }
  let result: unknown;
  if (options.command === "context") result = await bridgeRequest(options, "/api/bridge/context");
  else if (options.command === "next") result = await bridgeRequest(options, `/api/bridge/events?after=${options.after}&waitMs=${options.waitMs}`);
  else if (options.command === "watch") {
    do {
      result = await bridgeRequest(options, `/api/bridge/events?after=${options.after}&waitMs=${options.waitMs}`);
    } while (bridgeEvents(result).length === 0);
  }
  else if (options.command === "respond") {
    if (!options.eventId || !options.leaseId || !options.file) throw new Error("respond requires --event ID, --lease LEASE_ID, and --file PATH.");
    result = await bridgeRequest(options, "/api/bridge/respond", { method: "POST", body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId, message: await Bun.file(options.file).text() }) });
  } else if (options.command === "ack" || options.command === "renew") {
    if (!options.eventId || !options.leaseId) throw new Error(`${options.command} requires --event ID and --lease LEASE_ID.`);
    result = await bridgeRequest(options, `/api/bridge/${options.command}`, { method: "POST", body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId }) });
  } else if (options.command === "progress") {
    if (!options.eventId || !options.leaseId || !options.file) throw new Error("progress requires --event ID, --lease LEASE_ID, and --file PATH.");
    result = await bridgeRequest(options, "/api/bridge/progress", { method: "POST", body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId, message: await Bun.file(options.file).text() }) });
  } else {
    if (!options.eventId || !options.leaseId) throw new Error("refresh requires --event ID and --lease LEASE_ID.");
    const verification = options.verificationFile ? await Bun.file(options.verificationFile).text() : undefined;
    result = await bridgeRequest(options, "/api/bridge/refresh", { method: "POST", body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId, verification }) });
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
