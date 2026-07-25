// Runs in the MAIN world at document_start.
// Monkey-patches fetch + XHR so we can observe LeetCode's submission-check
// responses WITHOUT altering them. When a submission is Accepted, we relay the
// submission id + problem slug to the isolated content script via postMessage.
//
// The browser polls https://leetcode.com/submissions/detail/{id}/check/ after a
// submit; its JSON looks like:
//   { state: "SUCCESS", status_msg: "Accepted", question_id: "...", ... }

(function () {
  "use strict";

  if (window.__leet2gitInterceptorLoaded) {
    console.log("[Leet2Git] interceptor already active (MAIN world)");
    return;
  }
  window.__leet2gitInterceptorLoaded = true;

  console.log("[Leet2Git] interceptor active (MAIN world)");

  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?/;

  function currentTitleSlug() {
    // URL is /problems/<slug>/... while solving.
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function maybeReport(url, bodyText) {
    try {
      const m = String(url).match(CHECK_RE);
      if (!m) return;
      const data = JSON.parse(bodyText);
      if (data && data.state === "SUCCESS" && data.status_msg === "Accepted") {
        console.log("[Leet2Git] detected Accepted submission", m[1]);
        window.postMessage(
          {
            source: "leet2git",
            type: "ACCEPTED",
            payload: {
              submissionId: m[1],
              titleSlug: currentTitleSlug(),
              questionId: data.question_id || null,
              lang: data.lang || data.pretty_lang || null,
              runtime: data.status_runtime || null,
              memory: data.status_memory || null
            }
          },
          "*"
        );
      }
    } catch (_) {
      /* not JSON / unrelated request — ignore */
    }
  }

  // --- patch fetch ---
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const url = res.url || (args[0] && args[0].url) || args[0];
          if (CHECK_RE.test(String(url))) {
            res
              .clone()
              .text()
              .then((t) => maybeReport(url, t))
              .catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
  }

  // --- patch XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__l2g_url = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this.__l2g_url && CHECK_RE.test(String(this.__l2g_url))) {
          maybeReport(this.__l2g_url, this.responseText);
        }
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };
})();
