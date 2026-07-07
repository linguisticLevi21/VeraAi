#include <bits/stdc++.h>
using namespace std;    

int main ()
{
    int t;
    cin>>t;
    while(t--)
    {
        int n;
        cin>>n;
        string s;
        cin>>s;
        int less = 0;
        int m1= 0;
        int m2 = 0;
        int greater = 0;
        for(auto &i : s)
        {
            if(i=='<'){
                less++;
            }
            else{
                
             less = 0;
            }
            m1 = max(m1,less);
        }
        for(auto &i : s)
        {
            if(i=='>'){
                greater++;
            }
            else{
                
                greater = 0;
            }
            m2 = max(m2,greater);
        }
        int ans = max(m1,m2) + 1;
        cout<<ans<<endl;
    }
}