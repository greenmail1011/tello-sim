# 直接送 Tello SDK 的文字指令
from djitellopy import Tello

tello = Tello()
tello.send_control_command("command")
tello.send_control_command("takeoff")
tello.send_control_command("forward 100")
tello.send_control_command("cw 180")
tello.send_control_command("forward 100")
print("電量：", tello.send_read_command("battery?"))
tello.send_control_command("land")
