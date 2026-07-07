#include <bits/stdc++.h>
using namespace std;

int main()
{
    int t;
    cin>>t;
    while(t--)
    {
        long long n;
        cin>>n;

        int X = 0;
        int Y = 0;
        if(n==1)
        {
            cout<<0<<endl;
            continue;
        }
        if(n%3!=0)
            {
                cout<<-1<<endl;
                continue;
            }
        while(n>0)
        {
            
            if(n%3==0)
            {
                n = n/3;
                X++;
                if(n==1)
                {
                    break;
                }
            }
            else if(n%3!=0)
            {
                if(n%2==0)
                {
                    n = n/2;
                    Y++;
                }
                else
                {
                    break;
                }
            }
        }
        // while(n>0)
        // {
        //      if(n%3==0)
        //         {
        //             n = n / 3;
        //             Y++;
        //             if(n==1)
        //             {
        //                 break;
        //             }
        //         }
        // }
        if(X<Y || (X>0 && n!=1))
        {
            cout<<-1<<endl;
            continue;
        }
        int sixes = min(X,Y);
        int rem = abs(X-Y);

        cout<<sixes + 2*rem<<endl;
    }
}