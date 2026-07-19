"""Optional multi-source document adapters (not wired into seed_if_empty).

Production RAG uses ``runbook_seed.py``. The MOCK_* lists below are unused
fixtures for experiments — do not treat them as live Confluence/Jira/K8s.
"""

from __future__ import annotations

from langchain_core.documents import Document

SECURITY_PLAYBOOKS: list[dict] = [
    {
        "title": "Brute force login / account lockout response",
        "category": "auth",
        "service_hint": "AuthenticationService",
        "domain": "security",
        "content": (
            "Symptoms: repeated failed login attempts for the same account from one IP, "
            "WARNING AuthenticationService failed login, CRITICAL SecurityMonitor brute force "
            "detected, account locked. Resolution: (1) confirm lockout of targeted account; "
            "(2) block/blacklist source IP at WAF/firewall; (3) force password reset for admin "
            "accounts if compromise suspected; (4) review auth logs for successful logins from "
            "the same IP; (5) enable MFA and tighten lockout thresholds; (6) open a SecOps "
            "incident and preserve logs for forensics."
        ),
    },
    {
        "title": "SQL injection attack blocked by WAF",
        "category": "auth",
        "service_hint": "WebApplicationFirewall",
        "domain": "security",
        "content": (
            "Symptoms: WAF WARNING SQL Injection pattern detected, CRITICAL SQL Injection Attack "
            "Confirmed with payload like ' OR 1=1 --, request blocked. Resolution: (1) verify "
            "WAF blocked the request end-to-end; (2) blacklist source IP; (3) audit /login and "
            "adjacent endpoints for parameterization gaps; (4) enable/strengthen prepared "
            "statements; (5) scan app for SQLi with OWASP ZAP/sqlmap in staging; (6) alert "
            "SecOps and retain WAF evidence."
        ),
    },
    {
        "title": "Ransomware / malware on endpoint host",
        "category": "config",
        "service_hint": "EndpointProtection",
        "domain": "security",
        "content": (
            "Symptoms: malware signature in office macros, CRITICAL ransomware activity, "
            "encryptor.exe, host isolated automatically. Resolution: (1) keep host isolated "
            "from network; (2) capture memory/disk forensic image before wipe if policy allows; "
            "(3) identify patient-zero and lateral movement; (4) reset credentials used on host; "
            "(5) restore from known-good backups; (6) reimage host; (7) notify IR / legal per "
            "ransomware playbook."
        ),
    },
    {
        "title": "Unauthorized privilege escalation attempt",
        "category": "auth",
        "service_hint": "IdentityAccessMgmt",
        "domain": "security",
        "content": (
            "Symptoms: WARNING IAM privilege escalation requested by guest, CRITICAL "
            "unauthorized privilege escalation blocked for System Administrator role. "
            "Resolution: (1) confirm request was denied; (2) disable or quarantine the user "
            "account; (3) review IAM audit trail for related grants; (4) check for stolen "
            "session tokens; (5) enforce least privilege and approval workflows; (6) escalate "
            "to identity security team."
        ),
    },
    {
        "title": "Distributed port scan detection",
        "category": "network",
        "service_hint": "Firewall",
        "domain": "security",
        "content": (
            "Symptoms: WARNING Firewall port scanning detected, CRITICAL Distributed Port Scan "
            "with hundreds/thousands of ports in under a minute, IP blacklisted. Resolution: "
            "(1) confirm blacklist applied; (2) correlate with other probes from same ASN; "
            "(3) ensure unused ports are closed; (4) rate-limit inbound SYN where possible; "
            "(5) create SecOps ticket and watch for follow-on exploitation."
        ),
    },
    {
        "title": "Critical file integrity change / possible root compromise",
        "category": "config",
        "service_hint": "FileIntegrityMonitor",
        "domain": "security",
        "content": (
            "Symptoms: unauthorized modification of /etc/passwd, CRITICAL system file modified, "
            "possible root compromise. Resolution: (1) isolate the host immediately; (2) do not "
            "reboot until memory capture if forensics required; (3) compare file hashes to golden "
            "baseline; (4) inspect cron, SSH authorized_keys, new users; (5) rotate all host "
            "credentials; (6) rebuild from trusted image after IR approval."
        ),
    },
    {
        "title": "Suspected data exfiltration over encrypted channel",
        "category": "network",
        "service_hint": "NetworkMonitor",
        "domain": "security",
        "content": (
            "Symptoms: unusual outbound traffic, CRITICAL Data Exfiltration suspected with large "
            "GB transfer from DB host to external IP over encrypted channel. Resolution: "
            "(1) block destination IP/domain at egress firewall; (2) isolate source host "
            "DB-PROD-02; (3) revoke DB credentials and rotate secrets; (4) preserve NetFlow/"
            "packet captures; (5) assess data classification impact; (6) follow breach "
            "notification playbook with SecOps/legal."
        ),
    },
]

MOCK_CONFLUENCE: list[dict] = [
    {
        "title": "Confluence: Production incident response SOP",
        "category": "config",
        "service_hint": "",
        "domain": "devops",
        "content": (
            "Internal SOP: declare incident severity, page on-call, open bridge, capture timeline, "
            "mitigate first then root-cause. For security severity-1 events, loop in SecOps within "
            "15 minutes. Attach evidence links and do not wipe hosts before IR approval."
        ),
    },
    {
        "title": "Confluence: Auth service runbook index",
        "category": "auth",
        "service_hint": "AuthenticationService",
        "domain": "security",
        "content": (
            "Auth service ops notes: failed login spikes often precede brute force. Check Redis "
            "rate-limiter, Cloudflare/WAF IP lists, and IAM lockout policy. Never unlock admin "
            "without verifying MFA enrollment."
        ),
    },
]

MOCK_JIRA_HISTORY: list[dict] = [
    {
        "title": "Jira INC-4421: Port scan followed by SSH brute force",
        "category": "network",
        "service_hint": "Firewall",
        "domain": "security",
        "content": (
            "Past incident: scanner IP probed 1024 ports then attempted SSH. Mitigation was "
            "immediate blacklist + fail2ban sync. Postmortem: correlated Firewall CRITICAL with "
            "AuthenticationService WARNINGs; recommend shared SecOps dashboard."
        ),
    },
    {
        "title": "Jira INC-3980: DB outbound exfil blocked at egress",
        "category": "network",
        "service_hint": "NetworkMonitor",
        "domain": "security",
        "content": (
            "Past incident: DB-PROD transferred large encrypted payload to unknown VPS. Fix: "
            "egress allowlist for DB subnet, rotate credentials, forensics on host. Similar "
            "signatures: NetworkMonitor CRITICAL data exfiltration + unusual outbound traffic."
        ),
    },
]

MOCK_K8S_DOCS: list[dict] = [
    {
        "title": "Kubernetes docs: CrashLoopBackOff troubleshooting",
        "category": "container_crash",
        "service_hint": "",
        "domain": "devops",
        "content": (
            "Official-style guidance: inspect previous logs, events, probes, image pull secrets, "
            "and resource limits. Use kubectl describe/logs --previous. Restart alone is not a "
            "root-cause fix."
        ),
    },
    {
        "title": "Kubernetes docs: NetworkPolicy isolation checklist",
        "category": "network",
        "service_hint": "",
        "domain": "devops",
        "content": (
            "When services cannot reach each other: verify NetworkPolicy allow rules, DNS "
            "CoreDNS health, and CNI. Port scans from outside should be dropped at edge; "
            "internal east-west anomalies may indicate compromise."
        ),
    },
]


def _to_documents(entries: list[dict], source: str) -> list[Document]:
    docs: list[Document] = []
    for e in entries:
        docs.append(Document(
            page_content=e["content"],
            metadata={
                "title": e["title"],
                "category": e.get("category", "unknown"),
                "service_hint": e.get("service_hint", ""),
                "source": source,
                "environment": e.get("environment", "production"),
                "domain": e.get("domain", "devops"),
            },
        ))
    return docs


def load_security_playbooks() -> list[Document]:
    return _to_documents(SECURITY_PLAYBOOKS, source="security_playbook")


def load_mock_confluence() -> list[Document]:
    return _to_documents(MOCK_CONFLUENCE, source="mock_confluence")


def load_mock_jira_history() -> list[Document]:
    return _to_documents(MOCK_JIRA_HISTORY, source="mock_jira_history")


def load_mock_k8s_docs() -> list[Document]:
    return _to_documents(MOCK_K8S_DOCS, source="mock_k8s_docs")


def load_all_mock_sources() -> list[Document]:
    """Merge all mock enterprise sources for ingestion."""
    return (
        load_security_playbooks()
        + load_mock_confluence()
        + load_mock_jira_history()
        + load_mock_k8s_docs()
    )
