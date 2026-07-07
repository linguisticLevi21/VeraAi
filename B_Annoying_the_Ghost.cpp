#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int T;
    cin >> T;

    while (T--) {
        int n;
        cin >> n;

        vector<long long> a(n + 1), b(n + 1);

        for (int i = 1; i <= n; i++) cin >> a[i];
        for (int i = 1; i <= n; i++) cin >> b[i];

        vector<int> pos(n + 1);

        for (int i = 1; i <= n; i++) {
            pos[i] = lower_bound(b.begin() + 1, b.begin() + n + 1, a[i]) - b.begin();

            if (pos[i] > n) {
                pos[i] = -1;
            }
        }

        bool ok = true;
        for (int i = 1; i <= n; i++) {
            if (pos[i] == -1) {
                ok = false;
                break;
            }
        }

        if (!ok) {
            cout << -1 << '\n';
            continue;
        }

        vector<int> p(n + 1);

        for (int i = 1; i <= n; i++) {
            p[i] = pos[i];
        }

        for (int i = n - 1; i >= 1; i--) {
            if (b[i] >= a[i + 1]) {
                p[i + 1] = min(p[i + 1], p[i]);
            }
        }

        long long ans = 0;

        for (int i = 1; i <= n; i++) {
            for (int j = i + 1; j <= n; j++) {
                if (p[i] > p[j]) ans++;
            }
        }

        cout << ans << '\n';
    }

    return 0;
}