package main
import("testing";"time";"os")
func TestTemporaryTimePreview(t *testing.T){
m:=makeTimeTestModel(time.Now(),true);m.width=140;m.height=36;m.navFocus=false;m.cursor=1
m.org.Projects=[]Project{{Name:"学习.C++.标准库",Status:"active"},{Name:"学习.C++.练习",Status:"later"},{Name:"家庭财务",Status:"later"}}
m.timeState.Daily=&DailyLedgerSummary{Date:"2026-11-15",LocatedSegments:[]LocatedSegment{{ActivityID:"1",Title:"C++ 作用域、生命周期与 using",StartMs:time.Date(2026,11,15,8,0,0,0,time.Local).UnixMilli(),EndMs:time.Date(2026,11,15,9,15,0,0,time.Local).UnixMilli(),DurationSeconds:4500,ConfirmedCostCents:12497},{ActivityID:"2",Title:"C++ 指针",StartMs:time.Date(2026,11,15,10,0,0,0,time.Local).UnixMilli(),EndMs:time.Date(2026,11,15,10,36,0,0,time.Local).UnixMilli(),DurationSeconds:2160,ConfirmedCostCents:6139}}}
m.timeState.Weekly=&WeeklyDistributionSummary{Daily:[]DailyLedgerSummary{{Date:"2026-11-09"},{Date:"2026-11-10"},{Date:"2026-11-11",CoveredSeconds:7200,ConfirmedCostCents:20000},{Date:"2026-11-12",CoveredSeconds:3600,ConfirmedCostCents:10000},{Date:"2026-11-13",CoveredSeconds:1800,ConfirmedCostCents:5000},{Date:"2026-11-14"},{Date:"2026-11-15",CoveredSeconds:5400,ConfirmedCostCents:15000}}}
for _,view:=range []string{"time.today","time.weekly"}{m.view=view;m.syncTimeExtraRows();if err:=os.WriteFile("/Users/enmu/nexus/flowspace/Aster/output/playwright/"+view+".txt",[]byte(stripANSI(m.View())),0600);err!=nil{t.Fatal(err)}}
}
