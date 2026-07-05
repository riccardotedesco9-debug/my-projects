Attribute VB_Name = "modUtil"
Option Explicit

' Shared helpers. Timer state lives in named cells on the Settings sheet,
' never only in VBA globals, so a crash or VBA reset can never lose a
' running session (cells persist with every save; globals do not).

Public Const PROTECT_PW As String = ""

Public Function StateRange(ByVal rangeName As String) As Range
    Set StateRange = ThisWorkbook.Names(rangeName).RefersToRange
End Function

Public Function GetState(ByVal rangeName As String) As Variant
    GetState = StateRange(rangeName).Value
End Function

Public Sub SetState(ByVal rangeName As String, ByVal newValue As Variant)
    StateRange(rangeName).Value = newValue
End Sub

Public Function IsSilent() As Boolean
    On Error Resume Next
    IsSilent = (GetState("stSilentMode") = True)
End Function

Public Sub Notify(ByVal msg As String)
    If Not IsSilent() Then MsgBox msg, vbInformation, "Hours Tracker"
End Sub

' UserInterfaceOnly lets macros write locked cells but does not persist
' across sessions, so ThisWorkbook reapplies it on every open.
Public Sub ProtectUI(ByVal ws As Worksheet)
    On Error Resume Next
    ws.Unprotect PROTECT_PW
    On Error GoTo 0
    ws.Protect Password:=PROTECT_PW, UserInterfaceOnly:=True
End Sub

Public Sub ReapplyProtection()
    ProtectUI wshDashboard
    ProtectUI wshReport
    ProtectUI wshSummary
    ProtectUI wshSettings
End Sub

' Invoked once by the build script so a compile error in any module
' fails the build loudly instead of surfacing at first click.
Public Sub BuildSanityPing()
    Dim silentFlag As Boolean
    silentFlag = IsSilent()
    modUI.UpdateElapsed
    modTimer.PingCompile
    modReport.PingCompile
End Sub
