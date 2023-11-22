export type Entry = {
    term: number,
    item: any
}


export type LogTermAtResult = { type: "OK", term: number } | { type: "OutOfBounds", len: number } |
{ type: "InSnapshot", snapshotTerm: number, snapshotLen: number }

export type Raft = {
    snapshot: any,
    term: number,
    lastVote: string | null,
    log: Log,
    applier: (arg: ApplyMsg) => void,
    peers: string[],
    me: string,
    role: Roles,
    nextIndex: { [x: string]: number },
    lastReceivedLen: { [x: string]: number },
    commitLen: number,
    appliedLen: number,
    reset_election_timer: () => void,
    heartBeatTimers: Record<string, () => void>
}


export type RaftAPI = {
    "RequestVote": [RequestVoteArgs, RequestVoteResponse],
    "AppendEntries": [AppendEntriesArgs, AppendEntriesResponse],
    "InstallSnapshot": [InstallSnapshotArgs, InstallSnapshotResponse],
}

export type RequestVoteResponse = { nodeId: string, term: number, granted: boolean }
export type RequestVoteArgs = { term: number, candidateId: string, logLength: number, logTerm: number }
export type AppendEntriesResponse = { term: number, success: boolean, xterm: number, xlen: number, xindex: number }
export type AppendEntriesArgs = { term: number, leaderId: string, startIndex: number, prevLogTerm: number, entries: Entry[], leaderCommit: number }
export type InstallSnapshotArgs = { term: number, snapshotTerm: number, snapshotLen: number, snapshot: any }
export type InstallSnapshotResponse = { term: number }



export const requestVoteResponse = (nodeId: string, term: number, granted: boolean): RequestVoteResponse => ({ nodeId, term, granted })
export const requestVoteArgs = (term: number, candidateId: string, logLength: number, logTerm: number): RequestVoteArgs => ({ term, candidateId, logLength, logTerm })
export const appendEntriesResponse = (term: number, success: boolean, xterm: number, xlen: number, xindex: number): AppendEntriesResponse => ({ term, success, xterm, xlen, xindex });
export const appendEntriesArgs = (term: number, leaderId: string, startIndex: number, prevLogTerm: number, entries: Entry[], leaderCommit: number): AppendEntriesArgs => ({ term, leaderId, startIndex, prevLogTerm, entries, leaderCommit });
export const installSnapshotArgs = (term: number, snapshotTerm: number, snapshotLen: number, snapshot: any): InstallSnapshotArgs => ({ term, snapshotTerm, snapshotLen, snapshot });
export const installSnapshotResponse = (term: number): InstallSnapshotResponse => ({ term });



export enum Roles {
    Follower = "Follower",
    Leader = "Leader",
    Candidate = "Candidate",
}

export type SavedState = { lastVote: string | null, term: number, log: { items: Entry[], snapshotLen: number, snapshotTerm: number }, snapshot: any }
export type Snapshot = { type: "Snapshot", snapshot: any, snapshotTerm: number, snapshotLen: number }
export type Command = { type: "Command", index: number, term: number, item: any }
export type ApplyMsg = Snapshot | Command

export class Log {
    items: Entry[]
    snapshotLen: number
    snapshotTerm: number
    constructor(items: Entry[] = [], snapshotLen: number = 0, snapshotTerm: number = 0) {
        this.items = items
        this.snapshotLen =snapshotLen
        this.snapshotTerm = snapshotTerm
    }

    length() {
        return this.items.length + this.snapshotLen
    }
    last_term() {
        if (this.items.length == 0) {
            return this.snapshotTerm;
        }
        return this.items[this.items.length - 1].term;
    }
    term_at(index: number): LogTermAtResult {
        if (index == this.snapshotLen - 1) return { type: "OK", term: this.snapshotTerm };
        else if (index < this.snapshotLen) return { type: "InSnapshot", snapshotTerm: this.snapshotTerm, snapshotLen: this.snapshotLen }
        else if (this.items[index - this.snapshotLen] == undefined) return { type: "OutOfBounds", len: this.length() }
        else return { type: "OK", term: this.items[index - this.snapshotLen].term }
    }
    search_leftmost_term(term: number): number {
        if (term == this.snapshotTerm) return this.snapshotLen;
        return this.snapshotLen + this.items.findIndex(i => i.term == term)
    }

    search_rightmost_term(term: number): number {
        let index = this.items.findLastIndex(i => i.term == term);
        if (index == -1 && term == this.snapshotTerm) return this.snapshotLen
        else if (index == -1) return -1
        else return this.snapshotLen + index
    }

    append_entries(index: number, entries: Entry[]): void {
        if (entries.length == 0) return;
        else if (index < this.snapshotLen) this.items = this.items.concat(entries.slice(this.snapshotLen - index));
        else {
            let start = index - this.snapshotLen;
            for (const e of entries) this.items[start++] = e
        }
    }
    get_entries(index: number): Entry[] {
        return structuredClone(this.items.slice(index - this.snapshotLen));
    }

    snapshot(len: number, lastTerm: number): boolean {
        if (len < this.snapshotLen) return false
        else if (len == this.snapshotLen) return true
        if (len > this.length()) this.items = []
        else if (this.items[len - this.snapshotLen - 1].term == lastTerm) this.items = this.items.slice(len - this.snapshotLen)
        else this.items = []
        this.snapshotLen = len
        this.snapshotTerm = lastTerm
        return true;
    }
}