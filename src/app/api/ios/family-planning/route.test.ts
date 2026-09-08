import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load:vi.fn(),mutate:vi.fn(),identity:vi.fn() }));
vi.mock("@/app/actions/family-planning",()=>({loadFamilyPlanningAction:mocks.load,mutateFamilyPlanningAction:mocks.mutate}));
vi.mock("@/lib/server/ios-api",()=>({
  actionResponse:(result:{ok:boolean})=>Response.json(result,{status:result.ok?200:400}),
  requireIOSIdentity:mocks.identity,
  unauthorizedResponse:()=>Response.json({ok:false},{status:401}),
}));
import { GET, POST } from "@/app/api/ios/family-planning/route";
const post = (body:unknown) => POST(new NextRequest("https://weekofus.com/api/ios/family-planning",{method:"POST",body:JSON.stringify(body)}));
describe("native family planning API",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({identity:{userId:"user"}});mocks.mutate.mockResolvedValue({ok:true});mocks.load.mockResolvedValue({ok:true});});
  it("requires authentication before reads or mutations",async()=>{
    mocks.identity.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://weekofus.com/api/ios/family-planning?week=2026-09-07"))).status).toBe(401);
    expect((await post({action:"deleteChild"})).status).toBe(401);
    expect(mocks.mutate).not.toHaveBeenCalled();expect(mocks.load).not.toHaveBeenCalled();
  });
  it("forwards the selected week without caching another household's data",async()=>{
    await GET(new NextRequest("https://weekofus.com/api/ios/family-planning?week=2026-09-07"));
    expect(mocks.load).toHaveBeenCalledWith("2026-09-07");
  });
  it("preserves source adoption and stable native creation IDs",async()=>{
    const input={action:"saveRoutine",weekStart:"2026-09-07",sourceItemId:"00000000-0000-4000-8000-000000000001",routine:{id:"00000000-0000-4000-8000-000000000002",text:"School bag",frequency:"daily",interval:1,weekdays:[0,1,2,3,4],startsOn:"2026-09-07",active:true}};
    expect((await post(input)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith({...input,routine:{...input.routine,childId:null,endsOn:null}});
  });
  it("rejects invalid dates, unexpected commands and unbounded intervals",async()=>{
    expect((await post({action:"deleteChild",weekStart:"2026-02-30",id:"00000000-0000-4000-8000-000000000001"})).status).toBe(400);
    expect((await post({action:"eraseHousehold",weekStart:"2026-09-07"})).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("passes stale-review conflicts back to the client",async()=>{
    mocks.mutate.mockResolvedValue({ok:false,error:"Someone else updated this week's plan."});
    const response=await post({action:"saveReview",weekStart:"2026-09-07",priorities:"School",meals:"Pasta",logistics:"",revision:1});
    expect(response.status).toBe(400);expect((await response.json()).error).toContain("Someone else");
  });
});
