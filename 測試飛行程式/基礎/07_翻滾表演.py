# 先升高，再往四個方向翻滾
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_up(60)      # 翻滾前先飛高一點比較安全

tello.flip_forward()
tello.flip_back()
tello.flip_left()
tello.flip_right()

tello.land()
