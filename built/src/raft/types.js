export const requestVoteResponse = (nodeId, term, granted) => ({ nodeId, term, granted });
export const requestVoteArgs = (term, candidateId, logLength, logTerm) => ({ term, candidateId, logLength, logTerm });
export const appendEntriesResponse = (term, success, xterm, xlen, xindex) => ({ term, success, xterm, xlen, xindex });
export const appendEntriesArgs = (term, leaderId, startIndex, prevLogTerm, entries, leaderCommit) => ({ term, leaderId, startIndex, prevLogTerm, entries, leaderCommit });
export const installSnapshotArgs = (term, snapshotTerm, snapshotLen, snapshot) => ({ term, snapshotTerm, snapshotLen, snapshot });
export const installSnapshotResponse = (term) => ({ term });
export var Roles;
(function (Roles) {
    Roles["Follower"] = "Follower";
    Roles["Leader"] = "Leader";
    Roles["Candidate"] = "Candidate";
})(Roles || (Roles = {}));
export class Log {
    constructor(items = [], snapshotLen = 0, snapshotTerm = 0) {
        this.items = items;
        this.snapshotLen = snapshotLen;
        this.snapshotTerm = snapshotTerm;
    }
    length() {
        return this.items.length + this.snapshotLen;
    }
    last_term() {
        if (this.items.length == 0) {
            return this.snapshotTerm;
        }
        return this.items[this.items.length - 1].term;
    }
    term_at(index) {
        if (index == this.snapshotLen - 1)
            return { type: "OK", term: this.snapshotTerm };
        else if (index < this.snapshotLen)
            return { type: "InSnapshot", snapshotTerm: this.snapshotTerm, snapshotLen: this.snapshotLen };
        else if (this.items[index - this.snapshotLen] == undefined)
            return { type: "OutOfBounds", len: this.length() };
        else
            return { type: "OK", term: this.items[index - this.snapshotLen].term };
    }
    search_leftmost_term(term) {
        if (term == this.snapshotTerm)
            return this.snapshotLen;
        return this.snapshotLen + this.items.findIndex(i => i.term == term);
    }
    search_rightmost_term(term) {
        let index = this.items.findLastIndex(i => i.term == term);
        if (index == -1 && term == this.snapshotTerm)
            return this.snapshotLen;
        else if (index == -1)
            return -1;
        else
            return this.snapshotLen + index;
    }
    append_entries(index, entries) {
        if (entries.length == 0)
            return;
        else if (index < this.snapshotLen)
            this.items = this.items.concat(entries.slice(this.snapshotLen - index));
        else {
            let start = index - this.snapshotLen;
            for (const e of entries)
                this.items[start++] = e;
        }
    }
    get_entries(index) {
        return structuredClone(this.items.slice(index - this.snapshotLen));
    }
    snapshot(len, lastTerm) {
        if (len < this.snapshotLen)
            return false;
        else if (len == this.snapshotLen)
            return true;
        if (len > this.length())
            this.items = [];
        else if (this.items[len - this.snapshotLen - 1].term == lastTerm)
            this.items = this.items.slice(len - this.snapshotLen);
        else
            this.items = [];
        this.snapshotLen = len;
        this.snapshotTerm = lastTerm;
        return true;
    }
}
