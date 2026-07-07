#include <bits/stdc++.h>
using namespace std;

void solve() {
    int n;
    cin >> n;

    vector<int> p(n + 1), ans(n + 1);

    for (int i = 1; i <= n; i++) cin >> p[i];
    for (int i = 1; i <= n; i++) cin >> ans[i];

    queue<int> q;

    for (int i = 1; i <= n; i++) {
        if (ans[i] != -1) q.push(i);
    }

    bool possible = true;

    while (!q.empty() && possible) {
        int node = q.front();
        q.pop();

        int nxt = p[node];
        int need = p[ans[node]];

        if (ans[nxt] == -1) {
            ans[nxt] = need;
            q.push(nxt);
        }
        else if (ans[nxt] != need) {
            possible = false;
        }
    }

    if (!possible) {
        cout << "NO\n";
        return;
    }

    vector<bool> taken(n + 1, false);

    for (int i = 1; i <= n; i++) {
        if (ans[i] != -1) {
            if (ans[i] < 1 || ans[i] > n || taken[ans[i]]) {
                cout << "NO\n";
                return;
            }
            taken[ans[i]] = true;
        }
    }

    vector<int> comp(n + 1, -1);
    vector<vector<int>> cyc;
    vector<bool> vis(n + 1, false);

    for (int i = 1; i <= n; i++) {
        if (vis[i]) continue;

        vector<int> cur;
        int x = i;

        while (!vis[x]) {
            vis[x] = true;
            comp[x] = cyc.size();
            cur.push_back(x);
            x = p[x];
        }

        cyc.push_back(cur);
    }

    map<int, multiset<int>> freeVals;

    for (int v = 1; v <= n; v++) {
        if (!taken[v]) {
            int len = cyc[comp[v]].size();
            freeVals[len].insert(v);
        }
    }

    vector<pair<int,int>> emptyCycles;

    for (int id = 0; id < (int)cyc.size(); id++) {
        bool empty = true;

        for (int x : cyc[id]) {
            if (ans[x] != -1) {
                empty = false;
                break;
            }
        }

        if (empty) {
            int mn = *min_element(cyc[id].begin(), cyc[id].end());
            emptyCycles.push_back({mn, id});
        }
    }

    sort(emptyCycles.begin(), emptyCycles.end());

    for (auto &[mnPos, id] : emptyCycles) {
        int len = cyc[id].size();

        if (freeVals[len].empty()) {
            possible = false;
            break;
        }

        int startPos =
            find(cyc[id].begin(), cyc[id].end(), mnPos) - cyc[id].begin();

        int startVal = *freeVals[len].begin();
        int curVal = startVal;

        for (int step = 0; step < len; step++) {
            int idx = cyc[id][(startPos + step) % len];

            ans[idx] = curVal;

            freeVals[len].erase(freeVals[len].find(curVal));

            curVal = p[curVal];
        }
    }

    if (!possible) {
        cout << "NO\n";
        return;
    }

    cout << "YES\n";

    for (int i = 1; i <= n; i++) {
        cout << ans[i] << " \n"[i == n];
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int tc;
    cin >> tc;

    while (tc--) solve();
}