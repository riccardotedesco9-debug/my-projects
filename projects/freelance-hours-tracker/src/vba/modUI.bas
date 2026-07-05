Attribute VB_Name = "modUI"
Option Explicit

' Status banner + live elapsed display.
' OnTime bookkeeping: mNextTick mirrors the exact scheduled time because
' OnTime can only be cancelled with a matching EarliestTime. Tick reads
' the PERSISTED status (not a global) and self-extinguishes unless it is
' RUNNING, and BeforeClose always cancels - so a pending tick can never
' silently reopen the workbook after close (the classic OnTime zombie).

Private mNextTick As Date

Public Sub RefreshStatus()
    Dim banner As Range
    Set banner = StateRange("dbStatus")
    If CStr(GetState("stTimerStatus")) = "RUNNING" Then
        banner.Value = ChrW$(9654) & "  RUNNING " & ChrW$(8212) & " " & _
                       GetState("stCurrentClient") & " since " & _
                       Format$(CDate(GetState("stStartTime")), "hh:mm")
        banner.MergeArea.Interior.Color = RGB(46, 125, 50)
        UpdateElapsed
    Else
        banner.Value = ChrW$(9632) & "  IDLE " & ChrW$(8212) & " ready to start"
        banner.MergeArea.Interior.Color = RGB(107, 114, 128)
        StateRange("dbElapsed").Value = "0:00:00"
    End If
End Sub

Public Sub UpdateElapsed()
    If CStr(GetState("stTimerStatus")) <> "RUNNING" Then Exit Sub
    Dim secs As Long
    secs = DateDiff("s", CDate(GetState("stStartTime")), Now)
    If secs < 0 Then secs = 0
    StateRange("dbElapsed").Value = _
        (secs \ 3600) & ":" & Format$((secs Mod 3600) \ 60, "00") & ":" & Format$(secs Mod 60, "00")
End Sub

Public Sub StartTick()
    StopTick
    mNextTick = Now + TimeSerial(0, 0, 1)
    Application.OnTime mNextTick, "modUI.Tick"
End Sub

Public Sub StopTick()
    On Error Resume Next   ' errors if the tick already fired or was never scheduled
    If mNextTick <> 0 Then Application.OnTime mNextTick, "modUI.Tick", , False
    mNextTick = 0
End Sub

Public Sub Tick()
    mNextTick = 0
    If CStr(GetState("stTimerStatus")) <> "RUNNING" Then Exit Sub
    UpdateElapsed
    mNextTick = Now + TimeSerial(0, 0, 1)
    Application.OnTime mNextTick, "modUI.Tick"
End Sub
