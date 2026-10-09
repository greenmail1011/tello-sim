# 同樣飛 2 公尺，比較慢速和快速的差別
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

tello.set_speed(20)        # 慢速：每秒 20 公分
tello.move_forward(200)

tello.set_speed(100)       # 快速：每秒 100 公分
tello.move_back(200)

tello.land()
