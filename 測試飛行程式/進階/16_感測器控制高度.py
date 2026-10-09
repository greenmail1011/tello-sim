# 用 while 迴圈：高度沒到 150 公分就繼續往上
from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

while tello.get_height() < 150:
    tello.send_rc_control(0, 0, 40, 0)
    time.sleep(0.1)

tello.send_rc_control(0, 0, 0, 0)
print("到達高度：", tello.get_height(), "公分")
tello.land()
