"""
Run the CrewAI Extraction Agent on OCR text from Snowflake.
"""
import os
import json
from dotenv import load_dotenv
import snowflake.connector

from agents import create_extraction_agent, create_extraction_task
from crewai import Crew, Process

load_dotenv()

# OCR text from Snowflake (fetched earlier)
DOCUMENTS = {
    "08-30-2025": """C O 8 8403695.
S BlueCloud © Help i) Mikeagsemeso
lendor Cente
Weekly Timesheet List Manage employee time with NetSuite Payroll More
Mike Agrawal (V) 8/30/2025
Cancel  | Ccopy from Week| Prev Week Save
¥ Primary Information
Approved
v Classfcation
E
Enter Time ()
 Pending Rejected openApproved NOTETON 30T, MON, TUE, 3ED, THU, SERVICE ITEM BILLABLE MEMC DEPARTMENT LOCATION BILLING CLASS TOTAL
RSA 0:00 0:00
RSA : Randstad_Snowflake PS_Epiq_Onshore Sr. Solutions 0:00 0:00
Master Task (Project QSA 0:00 0:00 Task) 006Q0000ReVGr Snowflake Incorporated : Snowflake PS_Beacon Tech_QuickStart Accel lerator Solution Architect QSA Sr. Solutions 6:00 6:00 4:00 4:00 20:00 Architect Master Task (Project RSA Sr.Soltions 3:00 3:00 2:00 2:00 0:00 Architect Architect 06Qi00BhIL RandstadInhuseServices, LCdba andstad CorporateSevices: Randstad_Snowlake PS_EpiqOnshore Sr. Solutions Master Task (Project Consulting Services Yes RSA Sr. Solutions 3:00 3:00 2:00 2:00 0:00
Architect (T&M) <Type then tab>
v Add x Canel  Remove
Time Details (12)
Sat, 30 Sun, 31 0.01 1300 1200 200 1.00
3:00 200 Master Task Consulting Services(T&M) 0:00 3:00 2:00 10:00
06Qi000ReVGr Snowflake Incorporated : Snowflake PS_Beacon Tech_QuickStart Accelerator Solution Architect Consuling Services (T&M) 20:00 Master Task 6:00 6:00 4:00 1:00 Totals 2:00 12:00 8:00 3:00 40:00
Copy from Week Prev Week [Next Week | Cancel Actions
9/9/2025""",

    "9-6-2025": """C (  https://8403695.app.n actions/time/weeklytimebill.nl?id=1868688le=T8whe
vflake - FBlue oud - My Apps s Salesf r Snowflake Education (Ô Udemy - Snowflake ® JPMC VDI Q Bing |Cashback Y Top Cashback  Smart Agents  Math worksheets D Other favou
BlueCloud © Help Bluecloud Services Inc - Vendor Center
Upload
V Classification
SUBSIDIARY DATE SUBMITTED
Bluecloud Services Inc 9/15/2025
SAT SUN MON TUE WED THU FRI TOTAL
0:00 0:00 6:00 6:00 6:00 6:00 4:00 28:00
Enter Time ()
 Pending Open  Rejected Approved
SERVICE REJECTION BILLING SAT, SUN, MON, TUE, WED, THU, FRI, CUSTOMER : PROJECT CASE/TASK/EVENT TEM BILLABLE MEMO NOTE DEPARTMENT LOCATION CLASS 12 TO
006Qi00000P4aPt Randstad Inhouse Services, Master Task Consulting Yes RSA Sr. 2:00 2:00 2:00 2:00 2:00 10:0 LLC d/b/a Randstad Corporate Services : (Project Task) Services Solutions Randstad_Snowflake PS_Inspira_Onshore Sr. (T&M) Architect Solutions Architect 006Qi00000OBhIL Randstad Inhouse Services, Master Task Consulting Yes RSA Sr. 2:00 2:00 2:00 2:00 2:00 10:00 LLC d/b/a Randstad Corporate Services : (Project Task) Services Solutions Randstad_Snowflake PS_Epiq_Onshore Sr. (T&M) Architect
Solutions Architect 006Qi00000Pynlo Snowflake Incorporated : Master Task Consulting QSA Sr. 2:00 2:00 2:00 2:00 8:00 Snowflake PS_SS&C_QuickStart Accelerator (Project Task) Services Solutions
Solution Architect (Fixed Fee) Architect
<Type then tab>
Add x cancel || # Remove
Time Details (12)
Customer:Project Task Service Item Sat, 6 Sun, 7 Mon, 8 Tue, 9 Wed, 10 Thu, 11 Fri, 12 Total Master Task Consulting Services (T&M) 2:00 2:00 2:00 2:00 2:00 10:00
006Qi00000P4aPt Randstad Inhouse Services, LLC d/b/a Randstad Corp Master Task Consulting Services (T&M) 2:00 2:00 2:00 2:00 2:00 10:00
006Qi00000Pynlo Snowflake Incor Master Task ices (Fixed Fee) 2:00 2:00 2:00 2:00 8:00
Totals 0:00 0:00 6:00 6:00 6:00 6:00 4:00 28:00
Save- Cancel Copy from Week Prev Week Next Week Actions""",

    "9-13-2025": """A A» 4) ® s G | O L O (Update - actions/time/weeklytimebill.nl?id=189182&e=T&whence
Azure  Blue cloud - My Apps ng L Home Audio LO Clarity S NETGEAR Modem
eD BlueCloud luesloud - Vendor Cente
Weekly Timesheet List Manage employee time with NetSuite Payroll More
Mike Agrawal (V) 9/13/2025
Save  Cancel | Copy from Week Prev week Next Week Actions
» Primary Information
Approved
WEEK OF  9/13/2025
v Classification
SUBSIDIARY DATE SUBMITED
Bluecloud Services Inc /22/2025 TOTAL
Enter Time () () Open NOTETON SAN 10N, 16. 18 CUSTOMER : PROJECT CASE/TASK/EVENT SERVICE ITEM BILLABLE MEMC DEPARTMENT LOCATION BILLING CLASS
I_Snowflake Consulting Services Archtetos 2:00 Yes RSA 2:00 2:00 2:00 2:00 (T&M) 06Qi00TJs7 Snowfake Incorporated Snowflake PS_Stabiliy_QuickStart Accle erator Solution Architect Master Task (Project Consulting Services Yes QSA Sr. Soltons 4:00 4:00 4:00 4:00 4:00 20:00 Task) (Fixed Fee Architect <Type then tab>
vAdd x cancel Remove
Time Details (8)
Service Item Sat, 13 Sun, 14 120.16 200 100
Consulting Services (Fixed Fee) 4:00 4:00 4:00 4:00 4:00 20:00
Totals 5:00 6:00 6:00 6:00
Save - Cancel | Copy from Week Prev Week  Next Week Actions""",

    "9-20-2025": """D BlueCloud © Help êż Mike Agrawal (V) - Vendor Center
a Upload
Weekly Timesheet List More
Mike Agrawal (V) 9/20/2025
]Canel Copy from Week [Prev Week [Next Week | Actions
Y Primary Information APPROVAL STATUS
Approved
WEEK OF * 9/20/2025
Y Classification
SUBSIDIARY DATE SUBMITTED Bluecloud Services Inc 9/29/2025 SAT SUN MON TUE WED THU FRI 0:00:00 6:00 6:00 8:00 6:00 8:003:00
Enter Time ()
 Rejected open Pending_Approved
SUN, 23E, 2ED, 25 SERVICE ITEM DEPARTMENT BILLING CLASS 26 CUSTOMER : PROJECT CASE/TASK/EVENT BILLABLE MEMO LOCATION TOTAL
006Qi00000TJs7H Snowflake Incorporated : Snowflake PS_Stabilify_QuickStart 4:00 4:00 4:00 4:00 4:00 20:00
006Qi00000OBhIL Randstad Inhouse Services, LLC d/b/a Randstad Corp Consulting Services Master Task (Project Yes Sr. Solutions 2:00 2:00 200 2:00 2:00 0:00 PS_Epiq_Onshore Sr. Solutions Architect Task) (T&M) Architect 006Qi0000P4aPt Randstad Inhouse Services, LLC d/b/a Randstad Corpor ices : Randstad_Snowflake Master Task (Project Consulting Services Yes Sr. Solutions 2:00 2:00 4:00 PS_Inspira_Onshore Sr. Solutions Architect Task) T&M) <Type then tab>
v Add |x cancel |i Remove|
Time Details (9)
Task Service Item Tue, 23 Wed, 24 Thu, 25 10.00 shore Sr. Solutions Architect aster Task :00 006Qi0000P4aPt Randstad Inhouse Services, LC d/b/a Randstad Corporate Services : Randstad_Snowflake PS_Inspira_Onshore Sr.Solutions Architec Master Task Consulting Services (T&M) 2:00 2:00 4:00
006Qi0000TJs7H Snowflake Incorporated : Snowflake PS_Stabilfy_QuickStart Accelerator Solution Architect Consulting Services (Fixed Fee) 4:00 4:00 4:00 4:00 20:00 Totals 6:00 6:00 8:00 6:00 3:00 34:00
Save- Cancel Copyfrom Week Prev Week Next Week Actions""",

    "9-27-2025": """ BlueCloud © Help êż Mike Agrawal (V)  Vendor Center
a Upload
Weekly Timesheet
Mike Agrawal (V) 9/27/2025
Save  ]Canel Copy from Week Prev Week [Next Week
Y Primary Information
APPROVAL STATUS Approved WEEK OF * 2/27/2025
Y Classification
SUBSIDIARY DATE SUBMITTED Bluecloud Services Inc 10/7/2025 WED THU FRI TOTA
Enter Time () open Pending Approved  Rejected NoTERoN 28, SAT, 290N, 30E, WED, THU, 3RI, CUSTOMER : PROJECT CASE/TASK/EVENT SERVICE ITEM BILLABLE MEMO DEPARTMENT LOCATION BILLING CLASS TOTAL 060i0000BhiL Randstad Inhouse Services, Master Task (Project Consulting Services Yes 2:00 2:00 4:00 PS_Epiq_Onshore Sr. Solutions Architect rask) (T&M) <Type then tab>
|x cancel |i Remove V Add
Time Details (2) Task Sat, 27 Sun, 28 Mon, 29 Wed,1Thu, 2Fri, 3 006Qi00000BhIL Randstad Inhouse Service Master Task Consuling Services (T&M) 2:00 2:00 4:00
Totals
Save Cancel Copy from Week Prev Week Next Week Actions"""
}


def run_extraction(doc_id: str, ocr_text: str, doc_type: str = "TIMESHEET") -> dict:
    """Run extraction agent on a single document."""
    agent = create_extraction_agent()
    task = create_extraction_task(agent, ocr_text, doc_id, doc_type)
    
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=True,
    )
    
    result = crew.kickoff()
    
    # Handle different result formats
    if hasattr(result, 'pydantic') and result.pydantic:
        return result.pydantic.model_dump()
    elif hasattr(result, 'raw'):
        return {"doc_id": doc_id, "raw_output": result.raw, "lines": []}
    else:
        return {"doc_id": doc_id, "raw_output": str(result), "lines": []}


def main():
    print("=" * 60)
    print("Running CrewAI Extraction Agent on 5 timesheets")
    print("=" * 60)
    
    all_results = {}
    
    for doc_id, ocr_text in DOCUMENTS.items():
        print(f"\n>>> Processing {doc_id}...")
        try:
            result = run_extraction(doc_id, ocr_text)
            all_results[doc_id] = result
            print(f"<<< Completed {doc_id}: {len(result.get('lines', []))} lines extracted")
        except Exception as e:
            print(f"<<< ERROR processing {doc_id}: {e}")
            all_results[doc_id] = {"doc_id": doc_id, "error": str(e), "lines": []}
    
    # Save results to JSON
    with open("extraction_results.json", "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    
    print("\n" + "=" * 60)
    print("Results saved to extraction_results.json")
    print("=" * 60)
    
    # Print summary
    total_lines = sum(len(r.get("lines", [])) for r in all_results.values())
    print(f"\nTotal documents: {len(all_results)}")
    print(f"Total lines extracted: {total_lines}")
    
    return all_results


if __name__ == "__main__":
    main()
