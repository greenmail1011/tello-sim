# 往上 1 公尺、再往下 50 公分
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

tello.move_up(100)
print("現在高度：", tello.get_height(), "公分")
tello.move_down(50)
print("現在高度：", tello.get_height(), "公分")

tello.land()
