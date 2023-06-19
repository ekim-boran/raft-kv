import { Roles, SendRPC, cast_vote } from "./util.js"
import { send_append_entries } from "./replication.js"
import { log_last_term, log_length } from "./log.js"

const requestVoteResponse = (nodeId, term, granted) => ({ nodeId, term, granted })
const requestVoteArgs = (term, candidateId, logLength, logTerm) => ({ term, candidateId, logLength, logTerm })
const requestVoteRPC = (raft, to, args) => SendRPC(raft, to, "RequestVote", args).catch(e => { return requestVoteResponse(-1, -1, false) })

let majority = (raft) => Math.floor(raft.peers.length / 2) + 1;


function process_vote(raft, vote, votes, resolve) {
    if (raft.role != Roles.Candidate) resolve(-1);
    if (vote.term > raft.term) {
        cast_vote(raft, Roles.Follower, vote.term, -1)
        resolve(-1);
    }

    if (vote.granted && vote.term == raft.term) votes.accepted++;
    else votes.rejected++;

    if (votes.accepted >= majority(raft)) resolve(1);
    else if (votes.rejected >= majority(raft)) {
        raft.role = Roles.Follower;
        resolve(-1);
    }
}

export async function StartElection(raft) {
    if (raft.role != Roles.Follower) return;
    cast_vote(raft, Roles.Candidate, raft.term + 1, raft.me);
    let votes = { accepted: 1, rejected: 0 };
    let args = requestVoteArgs(raft.term, raft.me, log_length(raft), log_last_term(raft));
    let ok = await new Promise(resolve => raft.peers.map(to => requestVoteRPC(raft, to, args).then(vote => process_vote(raft, vote, votes, resolve))));

    if (ok == 1) {
        console.log("I am leader", raft.me, raft.term);
        raft.reset_election_timer();
        raft.role = Roles.Leader;
        raft.lastReceivedLen[raft.me] = log_length(raft)
        raft.peers.forEach(element => {
            raft.nextIndex[element] = log_length(raft);
            raft.lastReceivedLen[element] = 0;
        });
        raft.peers.map((to) => send_append_entries(raft, to));
    }
}

export function RequestVote(raft, { term, logTerm, logLength, candidateId }) {
    //console.log("Req vote received");
    if (term < raft.term) return requestVoteResponse(raft.me, raft.term, false);
    if (term > raft.term) cast_vote(raft, Roles.Follower, term, -1);
    let myLogLength = log_length(raft);
    let myLogTerm = log_last_term(raft);
    let logOk = logTerm > myLogTerm || (logTerm == myLogTerm && logLength >= myLogLength);
    let termOk = raft.lastVote == -1 || raft.lastVote == candidateId;

    if (logOk && termOk) {
        cast_vote(raft, Roles.Follower, term, candidateId);
        raft.reset_election_timer();
        return requestVoteResponse(raft.me, raft.term, true);
    }
    return requestVoteResponse(raft.me, raft.term, false);
}
