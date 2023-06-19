
export function new_log() {
    return { items: [], snapshotLen: 0, snapshotTerm: 0 }
}

export function log_length(raft) {
    return raft.log.items.length + raft.log.snapshotLen;
}

export function log_last_term(raft) {
    if (raft.log.items.length == 0) {
        return raft.log.snapshotTerm;
    }
    return raft.log.items[raft.log.items.length - 1].term;
}
export function log_term_at(raft, index) {
    if (index == raft.log.snapshotLen - 1) return { type: "OK", term: raft.log.snapshotTerm };
    else if (index < raft.log.snapshotLen) return { type: "InSnapshot", snapshotTerm: raft.log.snapshotTerm, snapshotLen: raft.log.snapshotLen }
    else if (raft.log.items[index - raft.log.snapshotLen] == undefined) return { type: "OutOfBounds", len: log_length(raft) }
    else return { type: "OK", term: raft.log.items[index - raft.log.snapshotLen].term }
}

export function log_search_leftmost_term(raft, term) {
    if (term == raft.log.snapshotTerm) return raft.log.snapshotLen;
    return raft.log.snapshotLen + raft.log.items.findIndex(i => i.term == term)
}

export function log_search_rightmost_term(raft, term) {
    let index = raft.log.items.findLastIndex(i => i.term == term);
    if (index == -1 && term == raft.log.snapshotTerm) return raft.log.snapshotLen
    else if (index == -1) return -1
    else return raft.log.snapshotLen + index
}

export function log_append_entries(raft, index, entries) {
    if (entries.length == 0) return;
    else if (index < raft.log.snapshotLen) raft.log.items = raft.log.items.concat(entries.slice(raft.log.snapshotLen - index));
    else {
        let start = index - raft.log.snapshotLen;
        for (const e of entries) raft.log.items[start++] = e
    }
}

export function log_get_entries(raft, index) {
    return structuredClone(raft.log.items.slice(index - raft.log.snapshotLen));
}

export function log_snapshot(raft, len, term) {
    if (len < raft.log.snapshotLen) return false
    else if (len == raft.log.snapshotLen) return true
    else if (len > log_length(raft)) raft.log = { items: [], snapshotLen: len, snapshotTerm: term }
    else raft.log = { items: raft.log.items.slice(len - raft.log.snapshotLen), snapshotLen: len, snapshotTerm: term }
    return true;
}