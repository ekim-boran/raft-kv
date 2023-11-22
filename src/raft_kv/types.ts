import { Raft } from "../raft/types.js";

export type Client = {
    leader: number;
    me: number;
    servers: string[];
    lastMessageId: number;
}

export type KVServer = {
    raft: Raft,
    items: Record<string, string>,
    lastProcessedMsgId: Record<string, number>,
    lastAppliedLen: number,
}

export type KVArgs = {
    op: "get" | "put" | "append";
    client_id: number;
    msg_id: number;
    key: string;
    value: string;
}

export type KVReply = { status: "OK", value: string } | {
    status: "NoKey" | "WrongLeader",
}

